"""
Django settings — production-ready defaults (MahaSoft) with env overrides for self-hosted VPS.

Deploy with DJANGO_SECRET_KEY (32+ chars). Optional `backend/.env` is loaded via python-dotenv.
Do not duplicate CORS headers in nginx; only Django should send Access-Control-Allow-Origin.

Production cutover checklist (non-exhaustive): use PostgreSQL with migrations and backups,
DEBUG=False, DJANGO_ALLOWED_HOSTS / FSERP_CORS_* / FSERP_CSRF_TRUSTED_ORIGINS / FRONTEND_BASE_URL for your domain,
HTTPS termination, CORS allowlist for browser origins only, rate limiting or WAF on auth endpoints (app-level limits on login/refresh/forgot-password; set DJANGO_CACHE_URL for multi-worker),
structured logging, and periodic restore drills.
"""
import os
import sys
from pathlib import Path

from corsheaders.defaults import default_headers
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

try:
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR / ".env")
except ImportError:
    pass

try:
    from fsms.release_info import APP_VERSION as _FSERP_APP_VERSION
except ImportError:
    _FSERP_APP_VERSION = "0.0.0-dev"

_manage_cmd = sys.argv[1] if len(sys.argv) > 1 else ""
_is_runserver = _manage_cmd == "runserver"

# Local `manage.py` without DJANGO_SECRET_KEY — fixed dev-only key (never use in production).
_manage_insecure_secret_ok = _manage_cmd in frozenset(
    {
        "runserver",
        "shell",
        "migrate",
        "makemigrations",
        "createsuperuser",
        "test",
        "showmigrations",
        "dbshell",
        "flush",
        "loaddata",
        "dumpdata",
        "sqlmigrate",
        "collectstatic",
        "check",
        "changepassword",
        "compilemessages",
        "makemessages",
        "ensure_platform_owner_email",
        "ensure_saas_superuser",
        "create_superuser",
    }
)

# --- Public site URLs (browser + API hostnames) ---
# Self-hosted VPS: set DJANGO_ALLOWED_HOSTS or FSERP_ALLOWED_HOSTS (comma-separated, no scheme), e.g.
# "api.example.com,example.com,www.example.com". If unset, MahaSoft defaults apply.


def _csv_env_list(name: str) -> list[str]:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return []
    return [p.strip() for p in raw.split(",") if p.strip()]


def _merge_unique(head: list[str], tail: list[str]) -> list[str]:
    return list(dict.fromkeys([*head, *tail]))


_default_allowed_hosts = ["api.mahasoftcorporation.com", "mahasoftcorporation.com"]
_env_allowed = _csv_env_list("DJANGO_ALLOWED_HOSTS") or _csv_env_list("FSERP_ALLOWED_HOSTS")
ALLOWED_HOSTS = _env_allowed if _env_allowed else list(_default_allowed_hosts)
if _is_runserver:
    ALLOWED_HOSTS = _merge_unique(ALLOWED_HOSTS, ["localhost", "127.0.0.1"])

DEBUG = _is_runserver

_secret = (os.environ.get("DJANGO_SECRET_KEY") or os.environ.get("SECRET_KEY") or "").strip()
if len(_secret) < 32:
    if "pytest" in sys.modules:
        _secret = "pytest-only-secret-key-do-not-use-in-production-32"
    elif _manage_insecure_secret_ok:
        _secret = "django-insecure-local-manage-only-not-for-production-use-32"
    else:
        raise ImproperlyConfigured(
            "Set DJANGO_SECRET_KEY (or SECRET_KEY) to a random string of at least 32 characters."
        )
SECRET_KEY = _secret

PLATFORM_TARGET_RELEASE = (_FSERP_APP_VERSION or "0.0.0-dev").strip()[:64]

# Built-in Master demo tenant (FS-000001) after `migrate` — disabled for pytest / `manage.py test` / env override.
SKIP_MASTER_TEMPLATE_BOOTSTRAP = (
    str(os.environ.get("FSERP_SKIP_MASTER_BOOTSTRAP", "")).strip().lower() in ("1", "true", "yes")
    or ("pytest" in sys.modules)
    or (_manage_cmd == "test")
)


def _env_truthy(name: str) -> bool:
    return str(os.environ.get(name, "")).strip().lower() in ("1", "true", "yes")


# Master template banners (CompactCompanyAlert / MasterCompanyBanner): optional fleet policy via env.
# Locked overrides testing when both are set.
MASTER_COMPANY_PROTECTION_LOCKED = _env_truthy("FSERP_MASTER_COMPANY_LOCKED")
MASTER_COMPANY_PROTECTION_TESTING = _env_truthy("FSERP_MASTER_COMPANY_TESTING")

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
            conn_max_age=600,
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
TIME_ZONE = "Asia/Dhaka"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Tenant backup / large uploads (nginx must allow the same body size)
_upload_cap = 256 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = _upload_cap
FILE_UPLOAD_MAX_MEMORY_SIZE = _upload_cap
DATA_UPLOAD_MAX_NUMBER_FIELDS = 10240

# CORS — do not duplicate Access-Control-* in nginx; Django sets them here.
CORS_ALLOW_ALL_ORIGINS = False
# Chrome may send preflight (incl. Private Network Access) for UI on *.localhost → API on localhost:8000.
CORS_ALLOW_PRIVATE_NETWORK = True
_default_cors_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://adib.localhost:3000",
    "https://mahasoftcorporation.com",
]
_env_cors_origins = _csv_env_list("FSERP_CORS_ALLOWED_ORIGINS")
CORS_ALLOWED_ORIGINS = _env_cors_origins if _env_cors_origins else list(_default_cors_origins)
# CORS_ALLOWED_ORIGINS does not support "*.domain"; use regex for subdomains.
_localhost_cors_regex = r"^http://[a-zA-Z0-9-]+\.localhost(:\d+)?$"
_default_cors_regexes = [
    r"^https://[a-zA-Z0-9-]+\.mahasoftcorporation\.com$",
    _localhost_cors_regex,
]
_env_cors_regexes = _csv_env_list("FSERP_CORS_ORIGIN_REGEXES")
CORS_ALLOWED_ORIGIN_REGEXES = (
    _env_cors_regexes if _env_cors_regexes else list(_default_cors_regexes)
)
if _is_runserver:
    _dev_cors = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://adib.localhost:3000",
    ]
    CORS_ALLOWED_ORIGINS = _merge_unique(CORS_ALLOWED_ORIGINS, _dev_cors)
    if _localhost_cors_regex not in CORS_ALLOWED_ORIGIN_REGEXES:
        CORS_ALLOWED_ORIGIN_REGEXES = [*CORS_ALLOWED_ORIGIN_REGEXES, _localhost_cors_regex]
CORS_ALLOW_HEADERS = list(default_headers) + [
    "x-selected-company-id",
    "x-selected-station-id",
    "x-tenant-subdomain",
    "x-request-id",
]

# CSRF — list explicit origins (scheme + host, optional port). Self-hosted: FSERP_CSRF_TRUSTED_ORIGINS.
_default_csrf_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://adib.localhost:3000",
    "https://mahasoftcorporation.com",
    "https://www.mahasoftcorporation.com",
    "https://localhost:3000",
]
_env_csrf = _csv_env_list("FSERP_CSRF_TRUSTED_ORIGINS")
CSRF_TRUSTED_ORIGINS = _env_csrf if _env_csrf else list(_default_csrf_origins)
if _is_runserver:
    _dev_csrf = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://adib.localhost:3000",
        "https://localhost:3000",
    ]
    CSRF_TRUSTED_ORIGINS = _merge_unique(CSRF_TRUSTED_ORIGINS, _dev_csrf)

REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
}

FRONTEND_BASE_URL = (
    (os.environ.get("FRONTEND_BASE_URL") or "https://mahasoftcorporation.com").strip().rstrip("/")
    or "https://mahasoftcorporation.com"
)

# Platform owner (role=super_admin) recovery mailbox. Used by ensure_platform_owner_email and
# create_superuser default. Override per deployment with FSERP_PLATFORM_OWNER_EMAIL.
FSERP_PLATFORM_OWNER_EMAIL = (
    (os.environ.get("FSERP_PLATFORM_OWNER_EMAIL") or "bismillah.filling@gmail.com").strip()
)
# Shown in password-reset and system emails.
FSERP_APP_DISPLAY_NAME = (os.environ.get("FSERP_APP_DISPLAY_NAME") or "FS ERP").strip() or "FS ERP"

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
DEFAULT_FROM_EMAIL = (os.environ.get("DEFAULT_FROM_EMAIL") or "FS ERP <noreply@mahasoftcorporation.com>").strip()

# Production: set DJANGO_CACHE_URL or REDIS_URL (e.g. redis://127.0.0.1:6379/1) so all workers share
# password-reset OTP / rate-limit counters. Omit for single-process dev (LocMem).
_cache_url = (os.environ.get("DJANGO_CACHE_URL") or os.environ.get("REDIS_URL") or "").strip()
_cache_prefix = (os.environ.get("FSERP_CACHE_KEY_PREFIX") or "fserp")[:32]
if _cache_url:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": _cache_url,
            "KEY_PREFIX": _cache_prefix,
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "fsms-password-reset",
        }
    }

# TLS terminated at reverse proxy
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True

SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_SECURE = not _is_runserver
CSRF_COOKIE_SECURE = not _is_runserver

# HTTPS hardening (optional). Prefer TLS redirect at nginx; use Django redirect only if no proxy does it.
if _env_truthy("FSERP_SECURE_SSL_REDIRECT") and not _is_runserver:
    SECURE_SSL_REDIRECT = True
_hsts_sec = int((os.environ.get("FSERP_SECURE_HSTS_SECONDS") or "0").strip() or "0")
if _hsts_sec > 0 and not _is_runserver:
    SECURE_HSTS_SECONDS = _hsts_sec
    SECURE_HSTS_INCLUDE_SUBDOMAINS = _env_truthy("FSERP_SECURE_HSTS_INCLUDE_SUBDOMAINS")
    SECURE_HSTS_PRELOAD = _env_truthy("FSERP_SECURE_HSTS_PRELOAD")

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
        "level": "INFO",
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
