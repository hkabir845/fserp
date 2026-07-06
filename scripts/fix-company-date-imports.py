#!/usr/bin/env python3
"""Add missing CompanyDateInput imports after bulk migration."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
IMPORT = "import { CompanyDateInput } from '@/components/CompanyDateInput'\n"


def add_import(content: str) -> str:
    if "'use client'" in content[:200]:
        idx = content.find("\n", content.find("'use client'")) + 1
        return content[:idx] + "\n" + IMPORT + content[idx:]
    m = re.search(r"^import .+$", content, re.MULTILINE)
    if m:
        return content[: m.end()] + "\n" + IMPORT + content[m.end() + 1 :]
    return IMPORT + content


def main() -> None:
    for path in sorted(SRC.rglob("*.tsx")):
        text = path.read_text(encoding="utf-8")
        if "CompanyDateInput" not in text:
            continue
        if "from '@/components/CompanyDateInput'" in text:
            continue
        path.write_text(add_import(text), encoding="utf-8")
        print(f"import added: {path.relative_to(SRC)}")


if __name__ == "__main__":
    main()
