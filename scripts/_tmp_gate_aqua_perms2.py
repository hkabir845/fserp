"""Add data_bank + financing GET module gates."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def gate_file(rel: str, module: str, fns: list[str], *, methods: str | None = None) -> None:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    if methods:
        deco = f'@require_aquaculture_module("{module}", methods={methods})\n'
    else:
        deco = f'@require_aquaculture_module("{module}")\n'
    added = 0
    missing = []
    for fn in fns:
        pat = rf"((?:@[^\n]+\n)+)def {fn}\("
        mm = re.search(pat, text)
        if not mm:
            missing.append(fn)
            continue
        if "require_aquaculture_module" in mm.group(1):
            continue
        new_block = mm.group(1).rstrip("\n") + "\n" + deco
        text = text[: mm.start(1)] + new_block + text[mm.end(1) :]
        added += 1
    path.write_text(text, encoding="utf-8")
    print(rel, "added", added, "missing", missing)


def main() -> None:
    gate_file(
        "backend/api/views/aquaculture_data_bank_views.py",
        "app.aquaculture.data_bank",
        [
            "aquaculture_data_bank_preview_pond_close",
            "aquaculture_data_bank_readiness_overview",
            "aquaculture_data_bank_return_warehouse",
            "aquaculture_data_bank_preview_station_close",
            "aquaculture_data_bank_close_pond",
            "aquaculture_data_bank_close_station",
            "aquaculture_data_bank_reopen_close",
            "aquaculture_data_bank_unlock_close",
            "aquaculture_data_bank_relock_close",
        ],
    )
    gate_file(
        "backend/api/views/aquaculture_financing_views.py",
        "app.aquaculture.financing",
        [
            "aquaculture_financing_overview",
            "aquaculture_financing_repayment_worksheet",
        ],
    )


if __name__ == "__main__":
    main()
