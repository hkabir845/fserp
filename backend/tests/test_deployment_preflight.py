"""Production readiness must fail closed, without sending email."""
from unittest.mock import MagicMock, patch

import pytest
from django.core.management import call_command, CommandError


@pytest.mark.parametrize("backend,password,message", [
    ("django.core.mail.backends.console.EmailBackend", "", "requires SMTP"),
    ("django.core.mail.backends.smtp.EmailBackend", "REPLACE_WITH_GMAIL_APP_PASSWORD", "template"),
])
def test_preflight_rejects_unusable_email(settings, backend, password, message):
    settings.EMAIL_BACKEND = backend
    settings.EMAIL_HOST_PASSWORD = password
    with patch("api.management.commands.deployment_preflight.call_command"), patch(
        "api.management.commands.deployment_preflight.get_connection"
    ) as connect:
        with pytest.raises(CommandError, match=message):
            call_command("deployment_preflight")
        connect.assert_not_called()


def test_preflight_connects_without_sending(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    settings.EMAIL_HOST_PASSWORD = "test-only"
    connection = MagicMock()
    with patch("api.management.commands.deployment_preflight.call_command") as check, patch(
        "api.management.commands.deployment_preflight.get_connection", return_value=connection
    ):
        call_command("deployment_preflight")
    check.assert_called_once_with("check", deploy=True, fail_level="WARNING")
    connection.__enter__.assert_called_once()
    connection.__enter__.return_value.send_messages.assert_not_called()


def test_preflight_redacts_smtp_failure(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    settings.EMAIL_HOST_PASSWORD = "test-only"
    with patch("api.management.commands.deployment_preflight.call_command"), patch(
        "api.management.commands.deployment_preflight.get_connection",
        side_effect=OSError("sensitive provider response"),
    ):
        with pytest.raises(CommandError, match="failed") as exc:
            call_command("deployment_preflight")
    assert "sensitive" not in str(exc.value)
