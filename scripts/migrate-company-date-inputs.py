#!/usr/bin/env python3
"""Replace native <input type="date"> with CompanyDateInput across frontend/src."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"

SKIP = {
    "components/CompanyDateInput.tsx",
    "utils/date.ts",
}

IMPORT_LINE = "import { CompanyDateInput } from '@/components/CompanyDateInput'\n"

ATTR_RE = re.compile(r"(\w+(?:-\w+)*)\s*=\s*(\{[^}]+\}|\"[^\"]*\"|'[^']*')")
TYPE_DATE_RE = re.compile(r"\btype\s*=\s*[\"']date[\"']", re.IGNORECASE)


def parse_jsx_attrs(tag: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    i = tag.find("<input")
    if i == -1:
        return attrs
    i = tag.find(" ", i)
    while i < len(tag):
        while i < len(tag) and tag[i].isspace():
            i += 1
        if i >= len(tag) or tag[i] in "/>":
            break
        name_start = i
        while i < len(tag) and (tag[i].isalnum() or tag[i] in "-_"):
            i += 1
        name = tag[name_start:i]
        if not name:
            i += 1
            continue
        while i < len(tag) and tag[i].isspace():
            i += 1
        if i >= len(tag) or tag[i] != "=":
            attrs[name] = "{true}"
            continue
        i += 1
        while i < len(tag) and tag[i].isspace():
            i += 1
        if i >= len(tag):
            break
        if tag[i] in "\"'":
            q = tag[i]
            i += 1
            val_start = i
            while i < len(tag) and tag[i] != q:
                i += 1
            attrs[name] = tag[val_start - 1 : i + 1]
            i += 1
        elif tag[i] == "{":
            depth = 0
            val_start = i
            while i < len(tag):
                if tag[i] == "{":
                    depth += 1
                elif tag[i] == "}":
                    depth -= 1
                    if depth == 0:
                        attrs[name] = tag[val_start : i + 1]
                        i += 1
                        break
                i += 1
        else:
            i += 1
    return attrs


def rel_posix(p: Path) -> str:
    return p.relative_to(SRC).as_posix()


def ensure_import(content: str) -> str:
    if "CompanyDateInput" in content:
        return content
    if "'use client'" in content[:200]:
        idx = content.find("\n", content.find("'use client'")) + 1
        return content[:idx] + "\n" + IMPORT_LINE + content[idx:]
    m = re.search(r"^import .+$", content, re.MULTILINE)
    if m:
        return content[: m.end()] + "\n" + IMPORT_LINE + content[m.end() + 1 :]
    return IMPORT_LINE + content


def find_date_input_spans(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    i = 0
    while True:
        start = text.find("<input", i)
        if start == -1:
            break
        j = start + 5
        depth = 0
        quote: str | None = None
        while j < len(text):
            c = text[j]
            if quote:
                if c == quote and text[j - 1] != "\\":
                    quote = None
                j += 1
                continue
            if c in "\"'":
                quote = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth = max(0, depth - 1)
            elif depth == 0 and c == "/" and j + 1 < len(text) and text[j + 1] == ">":
                end = j + 2
                chunk = text[start:end]
                if TYPE_DATE_RE.search(chunk):
                    spans.append((start, end))
                i = end
                break
            j += 1
        else:
            i = start + 6
            continue
        if j <= start + 5:
            i = start + 6
    return spans


def simplify_onchange(val: str) -> str | None:
    val = val.strip()
    inner = val.strip("{}").strip()
    m = re.match(r"\(\s*e\s*\)\s*=>\s*(\w+)\(\s*e\.target\.value\s*\)", inner)
    if m:
        return m.group(1)
    return None


def convert_onchange(on_change: str) -> str:
    setter = simplify_onchange(on_change)
    if setter:
        return f"onChange={{{setter}}}"
    inner = on_change.strip("{}").strip()
    inner = re.sub(r"\(\s*e\s*\)\s*=>", "(iso) =>", inner)
    inner = re.sub(r"e\.target\.value", "iso", inner)
    return f"onChange={{{inner}}}"


def convert_input(tag: str) -> str | None:
    if "defaultValue" in tag:
        return None
    attrs = parse_jsx_attrs(tag)

    value = attrs.get("value")
    if not value:
        return None

    on_change = attrs.get("onChange") or attrs.get("onchange")
    if not on_change:
        return None

    parts = [f"value={value}", convert_onchange(on_change)]
    for key in ("className", "id", "name", "disabled", "required", "min", "max", "aria-label"):
        if key in attrs:
            parts.append(f"{key}={attrs[key]}")

    return f"<CompanyDateInput {' '.join(parts)} />"


def process_file(path: Path) -> bool:
    rel = rel_posix(path)
    if rel in SKIP:
        return False
    text = path.read_text(encoding="utf-8")
    if not TYPE_DATE_RE.search(text):
        return False

    spans = find_date_input_spans(text)
    if not spans:
        return False

    changed = False
    out: list[str] = []
    pos = 0
    for start, end in spans:
        out.append(text[pos:start])
        converted = convert_input(text[start:end])
        if converted:
            out.append(converted)
            changed = True
        else:
            out.append(text[start:end])
        pos = end
    out.append(text[pos:])
    if not changed:
        return False

    new_text = ensure_import("".join(out))
    path.write_text(new_text, encoding="utf-8")
    print(f"updated {rel}")
    return True


def main() -> int:
    n = 0
    for path in sorted(SRC.rglob("*.tsx")):
        if process_file(path):
            n += 1
    print(f"Done: {n} files updated")
    remaining = []
    for path in SRC.rglob("*.tsx"):
        rel = rel_posix(path)
        if rel in SKIP:
            continue
        t = path.read_text(encoding="utf-8")
        if TYPE_DATE_RE.search(t):
            remaining.append(rel)
    if remaining:
        print("Manual review still needed:")
        for r in remaining:
            print(f"  - {r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
