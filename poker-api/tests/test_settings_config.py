from app.config import Settings


def test_settings_parse_comma_separated_cors_origins():
    settings = Settings(CORS_ORIGINS="https://beta.example.com, https://app.example.com")

    assert settings.cors_origins == [
        "https://beta.example.com",
        "https://app.example.com",
    ]


def test_settings_parse_json_array_cors_origins():
    settings = Settings(CORS_ORIGINS='["https://beta.example.com", "https://app.example.com"]')

    assert settings.cors_origins == [
        "https://beta.example.com",
        "https://app.example.com",
    ]
