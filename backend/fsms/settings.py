"""
Django settings for FSMS project.
"""
import os
import sys
from pathlib import Path

from corsheaders.defaults import default_headers
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

try:
    from fsms.release_info import APP_VERSION as _FSERP_APP_VERSION
except ImportError:
    _FSERP_APP_VERSION = "0.0.0-dev"


def _env_bool(key: str, *, default: bool) -> bool:
    raw = (os.environ.get(key) or "").strip().lower()
    if raw == "":
        return default
    return raw in ("1", "true", "yes", "on")


# Default True when unset so local dev keeps working without a .env.
DEBUG = _env_bool("DJANGO_DEBUG", default=True)

# Only for local dev when DJANGO_SECRET_KEY is unset — never use in production.
_DEV_SECRET_KEY_FALLBACK = "ahdjkahduihduiwye786284yu289u89&*sfhewuifhweihfke"
SECRET_KEY = (os.environ.get("DJANGO_SECRET_KEY") or os.environ.get("SECRET_KEY") or "").strip() or _DEV_SECRET_KEY_FALLBACK
if not DEBUG:
    if SECRET_KEY == _DEV_SECRET_KEY_FALLBACK or len(SECRET_KEY) < 32:
        raise ImproperlyConfigured(
            "Production requires DJANGO_SECRET_KEY (or SECRET_KEY) set to a random string of at least 32 characters."
        )

_allowed = (os.environ.get("DJANGO_ALLOWED_HOSTS") or "").strip()
if DEBUG:
    ALLOWED_HOSTS = (
        [h.strip() for h in _allowed.split(",") if h.strip()] if _allowed else ["*"]
    )
else:
    ALLOWED_HOSTS = [h.strip() for h in _allowed.split(",") if h.strip()]
    if not ALLOWED_HOSTS:
        raise ImproperlyConfigured(
            "Production requires DJANGO_ALLOWED_HOSTS as a comma-separated list (no wildcards in production)."
        )

# Manual tenant rollout target (super admin applies per company). Override at deploy.
PLATFORM_TARGET_RELEASE = (
    (os.environ.get("FSERP_PLATFORM_RELEASE") or _FSERP_APP_VERSION or "0.0.0-dev").strip()[:64]
)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "api",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "fsms.middleware.CorrelationIdMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "fsms.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]
WSGI_APPLICATION = "fsms.wsgi.application"

DATABASE_URL = (os.environ.get("DATABASE_URL") or "").strip()
if DATABASE_URL:
    import dj_database_url

    DATABASES = {
        "default": dj_database_url.config(
            default=DATABASE_URL,
            conn_max_age=int(os.environ.get("DATABASE_CONN_MAX_AGE", "600") or "600"),
        )
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
# Business calendar day (invoices, dashboard "today", reports). Override via DJANGO_TIME_ZONE if needed.
TIME_ZONE = os.environ.get("DJANGO_TIME_ZONE", "Asia/Dhaka")
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Tenant JSON backup/restore: raise limits for production (nginx must allow body size too).
_file_mb = int(os.environ.get("FSERP_MAX_UPLOAD_MB", "256") or "256")
_file_bytes = max(_file_mb, 1) * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = int(os.environ.get("DATA_UPLOAD_MAX_MEMORY_SIZE", str(_file_bytes)))
FILE_UPLOAD_MAX_MEMORY_SIZE = int(os.environ.get("FILE_UPLOAD_MAX_MEMORY_SIZE", str(_file_bytes)))
DATA_UPLOAD_MAX_NUMBER_FIELDS = int(os.environ.get("DATA_UPLOAD_MAX_NUMBER_FIELDS", "10240"))

if DEBUG:
    CORS_ALLOW_ALL_ORIGINS = True
else:
    CORS_ALLOW_ALL_ORIGINS = False
    _cors_origins = (os.environ.get("DJANGO_CORS_ALLOWED_ORIGINS") or "").strip()
    CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors_origins.split(",") if o.strip()]
    if not CORS_ALLOWED_ORIGINS:
        raise ImproperlyConfigured(
            "Production requires DJANGO_CORS_ALLOWED_ORIGINS (comma-separated full origins, e.g. https://app.example.com)."
        )

# Preflight must allow every header the Next.js client sends (see src/lib/api.ts).
# If production still fails with "x-selected-company-id is not allowed", either deploy this file
# or fix nginx/cPanel: do not answer OPTIONS with a short Allow-Headers list — proxy OPTIONS to Django
# or add x-selected-company-id (and other custom headers) to the proxy's Access-Control-Allow-Headers.
CORS_ALLOW_HEADERS = list(default_headers) + [
    "x-selected-company-id",
    "x-tenant-subdomain",
    "x-request-id",
]

# Django 4+: trusted origins for CSRF (e.g. admin, session). Defaults to CORS_ORIGINS if unset.
CSRF_TRUSTED_ORIGINS = ['http://localhost:3000', 'https://*.mahasoftcorporation.com', 'https://mahasoftcorporation.com']

REST_FRAMEWORK = {"DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"]}

# Base URL for password-reset links in emails (no trailing slash).
FRONTEND_BASE_URL = (os.environ.get("FRONTEND_BASE_URL") or "https://mahasoftcorporation.com").rstrip("/")

# Email: default console backend for development. Set EMAIL_HOST (+ user/password) to send real mail.
EMAIL_BACKEND = (os.environ.get("EMAIL_BACKEND") or "").strip()
if not EMAIL_BACKEND:
    EMAIL_BACKEND = (
        "django.core.mail.backends.smtp.EmailBackend"
        if (os.environ.get("EMAIL_HOST") or "").strip()
        else "django.core.mail.backends.console.EmailBackend"
    )
EMAIL_HOST = (os.environ.get("EMAIL_HOST") or "").strip()
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587") or "587")
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "true").lower() in ("1", "true", "yes")
EMAIL_HOST_USER = (os.environ.get("EMAIL_HOST_USER") or "").strip()
EMAIL_HOST_PASSWORD = (os.environ.get("EMAIL_HOST_PASSWORD") or "").strip()
DEFAULT_FROM_EMAIL = (os.environ.get("DEFAULT_FROM_EMAIL") or "FS ERP <noreply@localhost>").strip()

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "fsms-password-reset",
    }
}

# TLS is terminated at nginx / Apache / cPanel in front of Gunicorn/Passenger.
# Without this, Django sees http:// and may mis-handle redirects and secure cookies.
if os.environ.get("DJANGO_BEHIND_HTTPS_PROXY", "").lower() in ("1", "true", "yes"):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    if os.environ.get("DJANGO_USE_X_FORWARDED_HOST", "true").lower() in ("1", "true", "yes"):
        USE_X_FORWARDED_HOST = True

# --- Production hardening (no tenant data touched; deploy-time behaviour only) ---
if not DEBUG:
    SECURE_BROWSER_XSS_FILTER = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = "DENY"
    if os.environ.get("DJANGO_SECURE_SSL_REDIRECT", "").lower() in ("1", "true", "yes"):
        SECURE_SSL_REDIRECT = True
    if os.environ.get("DJANGO_SESSION_COOKIE_SECURE", "").lower() in ("1", "true", "yes"):
        SESSION_COOKIE_SECURE = True
    if os.environ.get("DJANGO_CSRF_COOKIE_SECURE", "").lower() in ("1", "true", "yes"):
        CSRF_COOKIE_SECURE = True
    _hsts = int(os.environ.get("DJANGO_SECURE_HSTS_SECONDS", "0") or "0")
    if _hsts > 0:
        SECURE_HSTS_SECONDS = _hsts
        SECURE_HSTS_INCLUDE_SUBDOMAINS = os.environ.get(
            "DJANGO_SECURE_HSTS_SUBDOMAINS", "true"
        ).lower() in ("1", "true", "yes")
        SECURE_HSTS_PRELOAD = os.environ.get("DJANGO_SECURE_HSTS_PRELOAD", "").lower() in (
            "1",
            "true",
            "yes",
        )

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "simple": {
            "format": "{levelname} {asctime} {name} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "simple",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO" if not DEBUG else "INFO"),
    },
    "loggers": {
        "django.request": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        },
        "django.security.DisallowedHost": {
            "handlers": ["console"],
            "level": "ERROR",
            "propagate": False,
        },
    },
}
