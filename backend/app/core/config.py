from typing import List, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "sqlite:///./erp.db"
    
    # Security
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    # CORS - allow localhost and 127.0.0.1 so browsers can access from either.
    # Override via env CORS_ORIGINS as JSON, e.g.
    # CORS_ORIGINS=["http://localhost:3000","http://fs.mahasoftcorporation.com"]
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://fs.mahasoftcorporation.com",
        "https://fs.mahasoftcorporation.com",
    ]

    # Fallback when `CORS_ORIGINS` is overridden or missing entries: any localhost / 127.0.0.1 port
    # (e.g. Next.js on 3000, 3002). Starlette matches the full Origin string against this regex.
    CORS_ALLOW_ORIGIN_REGEX: Optional[str] = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"

    # Explicit allowlist so preflight includes custom tenant headers (some proxies ignore "*").
    # Starlette also merges safelisted headers (Accept, Content-Type, etc.).
    CORS_ALLOW_HEADERS: List[str] = [
        "Authorization",
        "X-Tenant-Domain",
        "X-Tenant-Id",
        "X-Tenant-Subdomain",
    ]
    
    # Platform: logical tenant backups (JSON) written under this directory
    TENANT_BACKUP_DIR: str = "data/tenant_backups"

    # Tenant resolution
    TENANT_HEADER: str = "X-Tenant-Domain"
    TENANT_ID_HEADER: str = "X-Tenant-Id"
    ALLOW_HEADER_OVERRIDE: bool = True  # For dev
    
    class Config:
        env_file = ".env"
        case_sensitive = True

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _restore_dev_origins_if_empty(cls, v):
        """An empty env override (e.g. CORS_ORIGINS=[]) would block all browser origins."""
        if v is None or v == []:
            return [
                "http://localhost:3000",
                "http://localhost:3001",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:3001",
                "http://fs.mahasoftcorporation.com",
                "https://fs.mahasoftcorporation.com",
            ]
        return v


settings = Settings()

