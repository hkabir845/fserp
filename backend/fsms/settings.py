"""Django settings. Load `backend/.env` (and optional `backend/env/.env`). Production: set DJANGO_SECRET_KEY (32+ chars), DATABASE_URL, hosts, and CORS/CSRF env vars per `env.example`."""
import importlib.util
import os
import sys
from pathlib import Path

from corsheaders.defaults import default_headers
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

try:
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR / ".env")
    load_dotenv(BASE_DIR / "env" / ".env", override=False)
except ImportError:
    pass

try:
    from fsms.release_info import APP_VERSION as _FSERP_APP_VERSION
except ImportError:
    _FSERP_APP_VERSION = "0.0.0-dev"

_manage_cmd = sys.argv[1] if len(sys.argv) > 1 else ""
_is_runserver = _manage_cmd == "runserver"

# Commands allowed to use a short dev-only SECRET_KEY (never use that key in production).
_DEV_SECRET_CMDS = frozenset(
    "runserver shell migrate makemigrations createsuperuser test showmigrations dbshell "
    "flush loaddata dumpdata sqlmigrate collectstatic check changepassword compilemessages "
    "makemessages ensure_platform_owner_email ensure_saas_superuser create_superuser".split()
)


def _csv(name: str) -> list[str]:
    raw = (os.environ.get(name) or "").strip()
    return [p.strip() for p in raw.split(",") if p.strip()] if raw else []


def _uniq(*lists: list[str]) -> list[str]:
    out: list[str] = []
    for lst in lists:
        for x in lst:
            if x not in out:
                out.append(x)
    return out


def _truthy(name: str) -> bool:
    return str(os.environ.get(name, "")).strip().lower() in ("1", "true", "yes")


# --- Core ---
_default_hosts = ["api.mahasoftcorporation.com", "mahasoftcorporation.com"]
_env_hosts = _csv("DJANGO_ALLOWED_HOSTS") or _csv("FSERP_ALLOWED_HOSTS")
ALLOWED_HOSTS = _env_hosts or list(_default_hosts)
if _is_runserver:
    ALLOWED_HOSTS = _uniq(ALLOWED_HOSTS, ["localhost", "127.0.0.1"])

DEBUG = _is_runserver

_secret = (os.environ.get("DJANGO_SECRET_KEY") or os.environ.get("SECRET_KEY") or "").strip()
if len(_secret) < 32:
    if "pytest" in sys.modules:
        _secret = "pytest-only-secret-key-do-not-use-in-production-32"
    elif _manage_cmd in _DEV_SECRET_CMDS:
        _secret = "django-insecure-local-manage-only-not-for-production-use-32"
    else:
        raise ImproperlyConfigured(
            "Set DJANGO_SECRET_KEY (or SECRET_KEY) to a random string of at least 32 characters."
        )
SECRET_KEY = _secret

PLATFORM_TARGET_RELEASE = (_FSERP_APP_VERSION or "0.0.0-dev").strip()[:64]

SKIP_MASTER_TEMPLATE_BOOTSTRAP = (
    _truthy("FSERP_SKIP_MASTER_BOOTSTRAP")
    or ("pytest" in sys.modules)
    or (_manage_cmd == "test")
)

MASTER_COMPANY_PROTECTION_LOCKED = _truthy("FSERP_MASTER_COMPANY_LOCKED")
MASTER_COMPANY_PROTECTION_TESTING = _truthy("FSERP_MASTER_COMPANY_TESTING")

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

# WhiteNoise serves collected static files when running under Gunicorn (DEBUG off). Skipped for
# runserver (Django's static finder), when FSERP_DISABLE_WHITENOISE=1 (nginx-only static), or when
# the package is not installed (migrate/check still work; install whitenoise for production).
def _whitenoise_available() -> bool:
    try:
        return importlib.util.find_spec("whitenoise") is not None
    except Exception:
        return False


_use_whitenoise = (
    (not _is_runserver)
    and (not _truthy("FSERP_DISABLE_WHITENOISE"))
    and _whitenoise_available()
)

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "fsms.middleware.CorrelationIdMiddleware",
    "django.middleware.security.SecurityMiddleware",
]
if _use_whitenoise:
    MIDDLEWARE.append("whitenoise.middleware.WhiteNoiseMiddleware")
MIDDLEWARE += [
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

# --- Database ---
DATABASE_URL = (os.environ.get("DATABASE_URL") or "").strip()
if _truthy("FSERP_USE_SQLITE"):
    DATABASE_URL = ""

if DATABASE_URL:
    try:
        import dj_database_url
    except ImportError as exc:
        raise ImproperlyConfigured(
            "DATABASE_URL is set but dj-database-url is missing. "
            "Use backend venv + pip install -r requirements.txt, or pip install dj-database-url, "
            "or set FSERP_USE_SQLITE=1 for local SQLite."
        ) from exc
    DATABASES = {"default": dj_database_url.config(default=DATABASE_URL, conn_max_age=600)}
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

if _use_whitenoise:
    STORAGES = {
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
    }

_upload_cap = 256 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = _upload_cap
FILE_UPLOAD_MAX_MEMORY_SIZE = _upload_cap
DATA_UPLOAD_MAX_NUMBER_FIELDS = 10240

# --- CORS / CSRF (custom headers for tenant scope; do not duplicate CORS in nginx) ---
_LOCAL = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://adib.localhost:3000",
]
_LOCALHOST_SUBDOMAIN = r"^http://[a-zA-Z0-9-]+\.localhost(:\d+)?$"

CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_PRIVATE_NETWORK = True
CORS_ALLOWED_ORIGINS = _csv("FSERP_CORS_ALLOWED_ORIGINS") or [
    *_LOCAL,
    "https://mahasoftcorporation.com",
]
CORS_ALLOWED_ORIGIN_REGEXES = _csv("FSERP_CORS_ORIGIN_REGEXES") or [
    r"^https://[a-zA-Z0-9-]+\.mahasoftcorporation\.com$",
    _LOCALHOST_SUBDOMAIN,
]
if _is_runserver:
    CORS_ALLOWED_ORIGINS = _uniq(CORS_ALLOWED_ORIGINS, _LOCAL)
    if _LOCALHOST_SUBDOMAIN not in CORS_ALLOWED_ORIGIN_REGEXES:
        CORS_ALLOWED_ORIGIN_REGEXES = [*CORS_ALLOWED_ORIGIN_REGEXES, _LOCALHOST_SUBDOMAIN]

CORS_ALLOW_HEADERS = list(default_headers) + [
    "x-selected-company-id",
    "x-selected-station-id",
    "x-tenant-subdomain",
    "x-request-id",
]

CSRF_TRUSTED_ORIGINS = _csv("FSERP_CSRF_TRUSTED_ORIGINS") or [
    *_LOCAL,
    "https://mahasoftcorporation.com",
    "https://www.mahasoftcorporation.com",
]
if _is_runserver:
    CSRF_TRUSTED_ORIGINS = _uniq(CSRF_TRUSTED_ORIGINS, _LOCAL + ["https://localhost:3000"])

REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
}

FRONTEND_BASE_URL = (
    (os.environ.get("FRONTEND_BASE_URL") or "https://mahasoftcorporation.com").strip().rstrip("/")
    or "https://mahasoftcorporation.com"
)
FSERP_PLATFORM_OWNER_EMAIL = (
    (os.environ.get("FSERP_PLATFORM_OWNER_EMAIL") or "bismillah.filling@gmail.com").strip()
)
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

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_SECURE = not _is_runserver
CSRF_COOKIE_SECURE = not _is_runserver

if _truthy("FSERP_SECURE_SSL_REDIRECT") and not _is_runserver:
    SECURE_SSL_REDIRECT = True
_hsts = int((os.environ.get("FSERP_SECURE_HSTS_SECONDS") or "0").strip() or "0")
if _hsts > 0 and not _is_runserver:
    SECURE_HSTS_SECONDS = _hsts
    SECURE_HSTS_INCLUDE_SUBDOMAINS = _truthy("FSERP_SECURE_HSTS_INCLUDE_SUBDOMAINS")
    SECURE_HSTS_PRELOAD = _truthy("FSERP_SECURE_HSTS_PRELOAD")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"simple": {"format": "{levelname} {asctime} {name} {message}", "style": "{"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "simple"}},
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django.request": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        "django.security.DisallowedHost": {"handlers": ["console"], "level": "ERROR", "propagate": False},
    },
}
