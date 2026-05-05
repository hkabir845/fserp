"""Django settings — production-oriented defaults for mahasoftcorporation.com (no .env)."""
import sys
from pathlib import Path

from corsheaders.defaults import default_headers

BASE_DIR = Path(__file__).resolve().parent.parent

try:
    from fsms.release_info import APP_VERSION as _FSERP_APP_VERSION
except ImportError:
    _FSERP_APP_VERSION = "0.0.0-dev"

# --- Public site (API + app + tenant subdomains) ---
_PRIMARY_HOST = "mahasoftcorporation.com"
_API_HOST = f"api.{_PRIMARY_HOST}"

_manage_cmd = sys.argv[1] if len(sys.argv) > 1 else ""
_RUNSERVER = _manage_cmd == "runserver"

ALLOWED_HOSTS = [
    _API_HOST,
    _PRIMARY_HOST,
    f"www.{_PRIMARY_HOST}",
    "testserver",
]
if _RUNSERVER:
    ALLOWED_HOSTS = [
        *ALLOWED_HOSTS,
        "localhost",
        "127.0.0.1",
        "[::1]",
    ]

DEBUG = bool(_RUNSERVER)

# Replace on the server with a unique value: python -c "import secrets; print(secrets.token_urlsafe(50))"
SECRET_KEY = "nR8vK2wP5mL9qX3jF7hD1sT6yU4iO0pC8bN2gA5eZ9xV3kM7wQ1rY5tI2oL6jH0fS4dG8aB3nU6eR9pW2y5K8mJ1cQ4vX7zF0hT3L6nY9oP2sA5dG8bV1kE4rU7iO0wZ3xC6jM9qH2fN5tR8yL1pW4gS7aD0eB3nK6vI9oXQ2uY5zF8"

PLATFORM_TARGET_RELEASE = (_FSERP_APP_VERSION or "0.0.0-dev").strip()[:64]

SKIP_MASTER_TEMPLATE_BOOTSTRAP = "pytest" in sys.modules or _manage_cmd == "test"
MASTER_COMPANY_PROTECTION_LOCKED = False
MASTER_COMPANY_PROTECTION_TESTING = False

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

# --- Database (SQLite; use PostgreSQL on the server by swapping ENGINE/NAME/HOST/USER/PASSWORD) ---
DATABASE_URL = f"sqlite:///{BASE_DIR / 'db.sqlite3'}"
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

_upload_cap = 256 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = _upload_cap
FILE_UPLOAD_MAX_MEMORY_SIZE = _upload_cap
DATA_UPLOAD_MAX_NUMBER_FIELDS = 10240

# --- CORS / CSRF (tenant subdomains: https://<slug>.mahasoftcorporation.com) ---
_TENANT_SUBDOMAIN_REGEX = rf"^https://[a-zA-Z0-9-]+\.{_PRIMARY_HOST.replace('.', r'\.')}$"

CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_PRIVATE_NETWORK = True
CORS_ALLOWED_ORIGINS = [
    f"https://{_PRIMARY_HOST}",
    f"https://www.{_PRIMARY_HOST}",
]
CORS_ALLOWED_ORIGIN_REGEXES = [
    _TENANT_SUBDOMAIN_REGEX,
]

CORS_ALLOW_HEADERS = list(default_headers) + [
    "x-selected-company-id",
    "x-selected-station-id",
    "x-tenant-subdomain",
    "x-request-id",
]

CSRF_TRUSTED_ORIGINS = [
    f"https://{_PRIMARY_HOST}",
    f"https://www.{_PRIMARY_HOST}",
]
if _RUNSERVER:
    CORS_ALLOWED_ORIGINS = [
        *CORS_ALLOWED_ORIGINS,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    CSRF_TRUSTED_ORIGINS = [
        *CSRF_TRUSTED_ORIGINS,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
}

FRONTEND_BASE_URL = f"https://{_PRIMARY_HOST}"
FSERP_PLATFORM_OWNER_EMAIL = "bismillah.filling@gmail.com"
FSERP_APP_DISPLAY_NAME = "FS ERP"

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
EMAIL_HOST = ""
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = ""
EMAIL_HOST_PASSWORD = ""
DEFAULT_FROM_EMAIL = f"FS ERP <noreply@{_PRIMARY_HOST}>"

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
SESSION_COOKIE_SECURE = not _RUNSERVER
CSRF_COOKIE_SECURE = not _RUNSERVER
# TLS is terminated at the reverse proxy; do not redirect HTTP here (avoids broken health checks and local tests).
SECURE_SSL_REDIRECT = False
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

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
