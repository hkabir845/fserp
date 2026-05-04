from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "api"

    def ready(self):
        # Register post_migrate handler for built-in Master demo tenant (FS-000001).
        import api.signals  # noqa: F401
