"""
Application configuration using Pydantic settings
"""
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""
    
    # Database
    DATABASE_URL: str = "postgresql://trian@localhost:5432/poker_platform"
    
    # Security
    SECRET_KEY: str = "your-secret-key-change-this-in-production-use-openssl-rand-hex-32"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    # App
    DEBUG: bool = True
    APP_NAME: str = "DormStacks API"
    VERSION: str = "1.0.0"
    
    # Environment Mode: "dev" or "production"
    # In dev mode: email verification is skipped
    # In production mode: email verification is required
    ENV_MODE: str = "dev"
    
    # Email Settings (for production mode)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    EMAIL_FROM: str = "noreply@poker-platform.com"
    EMAIL_VERIFICATION_EXPIRE_MINUTES: int = 15
    FEEDBACK_EXPORT_DIR: str = "feedback_reports"

    # Optional admin bootstrap (creates/promotes admin on startup)
    ADMIN_USERNAME: Optional[str] = None
    ADMIN_EMAIL: Optional[str] = None
    ADMIN_PASSWORD: Optional[str] = None
    ADMIN_RESET_PASSWORD: bool = False

    # Marketplace / payments (initial scaffolding)
    COIN_PAYMENT_PROVIDER: str = "stripe"
    STRIPE_PUBLIC_KEY: Optional[str] = None
    STRIPE_SECRET_KEY: Optional[str] = None
    
    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug_value(cls, value):
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "prod", "production"}:
                return False
        return value
    
    @property
    def is_production(self) -> bool:
        return self.ENV_MODE.lower() in ("production", "prod")
    
    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="ignore"
    )


settings = Settings()
