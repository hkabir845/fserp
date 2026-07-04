"""Live OpenRouter connectivity test for Company Brain (keys masked in output)."""
from __future__ import annotations

from django.core.management.base import BaseCommand

from api.services.brain import config as brain_config
from api.services.brain import gateway


class Command(BaseCommand):
    help = "Test OpenRouter API keys for Brain (free + paid tiers). Does not print raw keys."

    def handle(self, *args, **options):
        self.stdout.write("==> OpenRouter Brain connectivity test\n")

        for plan in ("free", "growth"):
            self.stdout.write(f"\n--- Plan tier: {plan} ---")
            ready = brain_config.openrouter_configured(plan=plan)
            self.stdout.write(f"  configured: {ready}")
            if not ready:
                self.stdout.write(self.style.WARNING("  SKIP — no API key for this tier"))
                continue

            _src, masked, _raw = brain_config._resolve_api_key(plan)  # noqa: SLF001
            self.stdout.write(f"  key source: {_src}")
            self.stdout.write(f"  key (masked): {masked or '(none)'}")

            models = brain_config.models_for_plan(plan)
            model = models.get("reasoning") or models.get("fast") or gateway.default_model()
            self.stdout.write(f"  test model: {model}")

            messages = [
                {
                    "role": "user",
                    "content": 'Reply with exactly one word: OK',
                }
            ]
            result = gateway.chat_completion_with_meta(
                messages=messages,
                model=model,
                api_key=brain_config.api_key_for_plan(plan),
                max_tokens=16,
                temperature=0,
                retries=1,
                timeout=45,
            )

            if result.content and not result.error:
                snippet = (result.content or "").strip()[:80]
                self.stdout.write(
                    self.style.SUCCESS(
                        f"  LIVE OK — model={result.model} tokens={result.total_tokens} "
                        f"latency={result.latency_ms}ms reply={snippet!r}"
                    )
                )
            else:
                self.stdout.write(
                    self.style.ERROR(
                        f"  LIVE FAILED — model={result.model} error={result.error or 'empty response'}"
                    )
                )

        self.stdout.write("\nDone.")
