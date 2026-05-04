# syntax=docker/dockerfile:1
ARG BUILDER_BASE_IMAGE=mcr.microsoft.com/dotnet/sdk:8.0-jammy@sha256:5a8fe3f3b17490b07ea836d020485d1c4631a0d00c5289ce1f37e3cf927913c1
FROM --platform=linux/amd64 ${BUILDER_BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        git \
        gzip \
        libtbb-dev \
        make \
        pkg-config \
        python3 \
        tar \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
