#!/usr/bin/env python3

import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import sys
from typing import Any

BASE_STRING_FIELDS = (
    "engine",
    "platform",
    "bundle_version",
    "built_at_utc",
    "entrypoint_hint",
    "dotnet_target",
)
BASE_LIST_FIELDS = ("required_files", "managed_assemblies", "native_libraries")
STRICT_STRING_FIELDS = (
    "source_repo",
    "source_ref_requested",
    "source_commit_resolved",
    "source_pin_mode",
    "builder_image",
    "builder_base_image",
    "builder_base_image_digest",
    "builder_platform",
    "builder_dockerfile_sha256",
    "build_script_version",
)
STRICT_LIST_FIELDS = ("source_patches_applied",)


def fail(message: str) -> None:
    raise SystemExit(f"ERROR: {message}")


def load_json(path: str) -> dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        fail(f"JSON file not found: {path}")
    except json.JSONDecodeError as exc:
        fail(f"Invalid JSON in {path}: {exc}")
    if not isinstance(data, dict):
        fail(f"Expected top-level JSON object in {path}")
    return data


def normalize_manifest_path(raw: Any) -> str:
    if not isinstance(raw, str):
        fail("Manifest path entries must be strings")
    value = raw.strip()
    if not value:
        fail("Manifest path entries must not be empty")
    if "\\" in value:
        fail(f"Manifest path must use forward slashes only: {raw}")
    expects_dir = value.endswith("/")
    normalized = value.rstrip("/")
    if not normalized:
        fail(f"Manifest path must not resolve to repository root: {raw}")
    path = pathlib.PurePosixPath(normalized)
    if path.is_absolute():
        fail(f"Manifest path must be relative: {raw}")
    for part in path.parts:
        if part in ("", ".", ".."):
            fail(f"Manifest path contains unsupported segment '{part}': {raw}")
    rendered = str(path)
    return rendered + "/" if expects_dir else rendered


def split_manifest_path(raw: str) -> tuple[str, bool]:
    normalized = normalize_manifest_path(raw)
    expects_dir = normalized.endswith("/")
    return normalized.rstrip("/"), expects_dir


def normalize_string_field(data: dict[str, Any], field: str, manifest_path: str, required: bool) -> str | None:
    value = data.get(field)
    if value is None:
        if required:
            fail(f"{manifest_path}: field '{field}' must be a non-empty string")
        return None
    if not isinstance(value, str) or not value.strip():
        fail(f"{manifest_path}: field '{field}' must be a non-empty string")
    return value.strip()


def normalize_string_list_field(
    data: dict[str, Any],
    field: str,
    manifest_path: str,
    *,
    required: bool,
    normalize_paths: bool,
    allow_empty: bool,
) -> list[str] | None:
    value = data.get(field)
    if value is None:
        if required:
            fail(f"{manifest_path}: field '{field}' must be an array")
        return None
    if not isinstance(value, list):
        fail(f"{manifest_path}: field '{field}' must be an array")
    if not value and not allow_empty:
        fail(f"{manifest_path}: field '{field}' must not be empty")

    normalized: list[str] = []
    seen: set[str] = set()
    for item in value:
        if normalize_paths:
            entry = normalize_manifest_path(item)
        else:
            if not isinstance(item, str) or not item.strip():
                fail(f"{manifest_path}: field '{field}' entries must be non-empty strings")
            entry = item.strip()
        if entry not in seen:
            normalized.append(entry)
            seen.add(entry)
    return normalized


def validate_manifest(data: dict[str, Any], manifest_path: str, *, require_build_metadata: bool) -> dict[str, Any]:
    normalized: dict[str, Any] = {}

    for field in BASE_STRING_FIELDS:
        value = normalize_string_field(data, field, manifest_path, required=True)
        assert value is not None
        normalized[field] = value

    if normalized["engine"] != "g5":
        fail(f"{manifest_path}: engine must be 'g5'")
    if normalized["platform"] != "linux-x64":
        fail(f"{manifest_path}: platform must be 'linux-x64'")

    for field in BASE_LIST_FIELDS:
        value = normalize_string_list_field(
            data,
            field,
            manifest_path,
            required=True,
            normalize_paths=True,
            allow_empty=False,
        )
        assert value is not None
        normalized[field] = value

    for field in STRICT_STRING_FIELDS:
        value = normalize_string_field(data, field, manifest_path, required=require_build_metadata)
        if value is not None:
            normalized[field] = value

    patches = normalize_string_list_field(
        data,
        "source_patches_applied",
        manifest_path,
        required=require_build_metadata,
        normalize_paths=False,
        allow_empty=True,
    )
    if patches is not None:
        normalized["source_patches_applied"] = patches

    pin_mode = normalized.get("source_pin_mode")
    if pin_mode is not None and pin_mode not in ("tracked", "override"):
        fail(f"{manifest_path}: source_pin_mode must be 'tracked' or 'override'")

    return normalized


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_layout(app_root: str, manifest: dict[str, Any]) -> None:
    if not os.path.isdir(app_root):
        fail(f"Runtime app directory does not exist: {app_root}")

    def check_entry(raw_path: str, *, require_file: bool) -> None:
        relative_path, expects_dir = split_manifest_path(raw_path)
        target = os.path.join(app_root, *relative_path.split("/"))
        if require_file:
            if not os.path.isfile(target):
                fail(f"Missing required file: {raw_path}")
            return
        if expects_dir:
            if not os.path.isdir(target):
                fail(f"Missing required directory: {raw_path}")
            return
        if not os.path.exists(target):
            fail(f"Missing required path: {raw_path}")

    for entry in manifest["required_files"]:
        check_entry(entry, require_file=False)
    for entry in manifest["managed_assemblies"]:
        check_entry(entry, require_file=True)
    for entry in manifest["native_libraries"]:
        check_entry(entry, require_file=True)


def write_install_metadata(
    metadata_path: str,
    manifest_path: str,
    bundle_url: str,
    expected_sha: str,
    actual_sha: str,
    active_path: str,
    version_key: str,
    downloaded_archive: str,
) -> None:
    manifest = validate_manifest(load_json(manifest_path), manifest_path, require_build_metadata=False)
    payload = {
        "engine": manifest["engine"],
        "bundle_url": bundle_url,
        "bundle_sha256_expected": expected_sha.lower(),
        "bundle_sha256_actual": actual_sha.lower(),
        "bundle_version": manifest["bundle_version"],
        "platform": manifest["platform"],
        "installed_at_utc": dt.datetime.now(tz=dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "active_path": active_path,
        "version_key": version_key,
        "downloaded_archive": downloaded_archive,
    }
    os.makedirs(os.path.dirname(metadata_path), exist_ok=True)
    with open(metadata_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def validate_metadata(
    metadata_path: str,
    manifest_path: str,
    current_link: str,
    active_path: str,
    repo_root: str,
) -> None:
    metadata = load_json(metadata_path)
    manifest = validate_manifest(load_json(manifest_path), manifest_path, require_build_metadata=False)

    required_fields = (
        "engine",
        "bundle_url",
        "bundle_sha256_expected",
        "bundle_sha256_actual",
        "bundle_version",
        "platform",
        "installed_at_utc",
        "active_path",
        "version_key",
        "downloaded_archive",
    )
    for field in required_fields:
        value = metadata.get(field)
        if not isinstance(value, str) or not value.strip():
            fail(f"{metadata_path}: field '{field}' must be a non-empty string")

    if metadata["engine"] != manifest["engine"]:
        fail(f"{metadata_path}: engine does not match active manifest")
    if metadata["platform"] != manifest["platform"]:
        fail(f"{metadata_path}: platform does not match active manifest")
    if metadata["bundle_version"] != manifest["bundle_version"]:
        fail(f"{metadata_path}: bundle_version does not match active manifest")
    if metadata["active_path"] != active_path:
        fail(f"{metadata_path}: active_path must be '{active_path}'")

    if not os.path.islink(current_link):
        fail(f"Current runtime pointer is not a symlink: {current_link}")
    resolved_current = os.path.realpath(current_link)
    resolved_version_key = os.path.basename(resolved_current.rstrip(os.sep))
    if resolved_version_key != metadata["version_key"]:
        fail(f"{metadata_path}: version_key does not match active runtime symlink")

    archive_path = os.path.join(repo_root, metadata["downloaded_archive"])
    if not os.path.isfile(archive_path):
        fail(f"{metadata_path}: downloaded archive is missing: {archive_path}")
    actual_sha = sha256_file(archive_path)
    if actual_sha.lower() != metadata["bundle_sha256_actual"].lower():
        fail(f"{metadata_path}: downloaded archive SHA256 does not match bundle_sha256_actual")


def make_version_key(manifest_path: str, actual_sha: str) -> None:
    manifest = validate_manifest(load_json(manifest_path), manifest_path, require_build_metadata=False)
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", manifest["bundle_version"]).strip("-")
    if not slug:
        slug = "bundle"
    print(f"{slug}-{actual_sha[:12].lower()}")


def print_field(manifest_path: str, field_name: str) -> None:
    manifest = validate_manifest(load_json(manifest_path), manifest_path, require_build_metadata=False)
    value = manifest.get(field_name)
    if isinstance(value, str):
        print(value)
    else:
        print(json.dumps(value))


def activate_current(engine_root: str, version_key: str) -> None:
    current_path = os.path.join(engine_root, "current")
    if os.path.lexists(current_path) and not os.path.islink(current_path):
        fail(f"Expected current runtime pointer to be a symlink: {current_path}")
    temp_link = current_path + ".new"
    if os.path.lexists(temp_link):
        os.unlink(temp_link)
    os.symlink(os.path.join("versions", version_key), temp_link)
    os.replace(temp_link, current_path)


def write_build_report(
    output_path: str,
    manifest_path: str,
    archive_filename: str,
    archive_sha256: str,
    output_directory: str,
) -> None:
    manifest = validate_manifest(load_json(manifest_path), manifest_path, require_build_metadata=True)
    payload = dict(manifest)
    payload["output_archive_filename"] = archive_filename
    payload["output_archive_sha256"] = archive_sha256.lower()
    payload["output_directory_path"] = output_directory
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        fail("Missing helper command")

    command = argv[1]
    if command == "validate-manifest":
        manifest_path = argv[2]
        print(json.dumps(validate_manifest(load_json(manifest_path), manifest_path, require_build_metadata=False), indent=2, sort_keys=True))
    elif command == "validate-manifest-strict":
        manifest_path = argv[2]
        print(json.dumps(validate_manifest(load_json(manifest_path), manifest_path, require_build_metadata=True), indent=2, sort_keys=True))
    elif command == "manifest-field":
        print_field(argv[2], argv[3])
    elif command == "validate-layout":
        manifest = validate_manifest(load_json(argv[2]), argv[2], require_build_metadata=False)
        validate_layout(argv[3], manifest)
    elif command == "write-install-metadata":
        write_install_metadata(*argv[2:10])
    elif command == "validate-metadata":
        validate_metadata(*argv[2:7])
    elif command == "version-key":
        make_version_key(argv[2], argv[3])
    elif command == "activate-current":
        activate_current(argv[2], argv[3])
    elif command == "write-build-report":
        write_build_report(*argv[2:7])
    else:
        fail(f"Unsupported helper command: {command}")


if __name__ == "__main__":
    main(sys.argv)
