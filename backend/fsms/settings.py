"""
Django settings — production (MahaSoft). Deploy with DJANGO_SECRET_KEY set on the host (32+ chars).
Do not duplicate CORS headers in nginx; only Django should send Access-Control-Allow-Origin.
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
    }
)

# --- Public site URLs (browser + API hostnames) ---
ALLOWED_HOSTS = ["api.mahasoftcorporation.com", "mahasoftcorporation.com"]
if _is_runserver:
    ALLOWED_HOSTS = list(dict.fromkeys([*ALLOWED_HOSTS, "localhost", "127.0.0.1"]))

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

# CORS — hardcoded (do not add CORS headers for this API in nginx)
CORS_ALLOW_ALL_ORIGINS = False
# Chrome may send preflight (incl. Private Network Access) for UI on *.localhost → API on localhost:8000.
CORS_ALLOW_PRIVATE_NETWORK = True
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    # Explicit tenant-style dev hosts (also covered by regex below; listed for clarity / older cors versions)
    "http://adib.localhost:3000",
    "https://mahasoftcorporation.com",
]
# CORS_ALLOWED_ORIGINS does not support "*.domain"; use regex for subdomains.
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^https://[a-zA-Z0-9-]+\.mahasoftcorporation\.com$",
    # Tenant-style local dev: http://adib.localhost:3000 → API on http://localhost:8000
    r"^http://[a-zA-Z0-9-]+\.localhost(:\d+)?$",
]
CORS_ALLOW_HEADERS = list(default_headers) + [
    "x-selected-company-id",
    "x-tenant-subdomain",
    "x-request-id",
]

# CSRF — hardcoded (Django has no wildcard here; list explicit origins)
CSRF_TRUSTED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://adib.localhost:3000",
    "https://mahasoftcorporation.com",
    "https://www.mahasoftcorporation.com",
    "https://localhost:3000",
]

REST_FRAMEWORK = {"DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"]}

FRONTEND_BASE_URL = "https://mahasoftcorporation.com"

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
