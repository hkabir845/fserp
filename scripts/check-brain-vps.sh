#!/usr/bin/env bash
# Inspect Brain / OpenRouter settings on VPS (keys are masked). Run from repo root:
#   bash scripts/check-brain-vps.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${REPO_ROOT}/backend"
ENV_FILE="${BACKEND}/.env"

mask_key() {
  local k="$1"
  if [[ -z "$k" ]]; then
    echo "(empty)"
    return
  fi
  local len=${#k}
  if (( len <= 10 )); then
    echo "••••••••"
    return
  fi
  echo "${k:0:6}••••••••${k: -4} (len=${len})"
}

echo "==> Server env OPENROUTER_API_KEY"
if [[ -f "$ENV_FILE" ]] && grep -qE '^OPENROUTER_API_KEY=' "$ENV_FILE" 2>/dev/null; then
  val="$(grep -E '^OPENROUTER_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r\"' | xargs)"
  if [[ -n "$val" ]]; then
    echo "    SET: $(mask_key "$val")"
  else
    echo "    (line present but empty)"
  fi
else
  echo "    NOT SET in backend/.env"
fi

echo ""
echo "==> SaaS DB: platform_brain_config (singleton)"
cd "$BACKEND"
# shellcheck disable=SC1091
source venv/bin/activate
python manage.py shell <<'PY'
import json
from api.models import Company, PlatformBrainConfig
from api.services.brain.config import serialize_brain_config_for_admin
from api.services.brain.plans import brain_plan_for_company, usage_status

cfg = serialize_brain_config_for_admin()
keys = [
    "free_api_key_set",
    "free_api_key_masked",
    "vendor_api_key_set",
    "vendor_api_key_masked",
    "env_fallback_configured",
    "env_fallback_masked",
    "active_key_free_plan_source",
    "active_key_free_plan_masked",
    "active_key_paid_plan_source",
    "active_key_paid_plan_masked",
    "llm_ready_free",
    "llm_ready_vendor",
    "updated_at",
]
print(json.dumps({k: cfg.get(k) for k in keys}, indent=2))

print("\n==> Companies (Brain plan + today usage)")
for c in Company.objects.filter(is_deleted=False).order_by("id")[:20]:
    st = usage_status(c)
    bp = getattr(c, "brain_plan", "") or "free"
    bill = (getattr(c, "billing_plan_code", None) or "").strip()
    print(
        f"  id={c.id:4} {c.name[:36]:36}  brain_plan={bp:10} billing={bill:12} "
        f"-> effective={st['plan']:10} today={st['messages_used_today']}/{st['daily_message_limit']}"
    )
PY

echo ""
echo "==> Live OpenRouter API test (minimal request)"
python manage.py test_brain_openrouter

echo ""
echo "Done. Free-plan companies use free_api_key first; daily limits are per company Brain tier."
