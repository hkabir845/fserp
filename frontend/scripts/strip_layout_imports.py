"""Remove Layout import and outer <Layout>...</Layout> wrapper from Next.js pages."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent / "src" / "app"

def strip_file(p: Path) -> bool:
    s = p.read_text(encoding="utf-8")
    if "from '@/components/Layout'" not in s:
        return False
    orig = s
    s = re.sub(r"^import \{ Layout \} from '@/components/Layout'\r?\n", "", s, count=1)
    if orig == s:
        s = re.sub(r"^import \{ Layout \} from \"@/components/Layout\"\r?\n", "", s, count=1)
    # Remove an outer <Layout> wrapper: non-greedy inner match, same indentation for closing tag
    for _ in range(20):
        m = re.search(r"\n([ \t]*)<Layout>([\s\S]*?)\n\1</Layout>", s)
        if not m:
            break
        inner = m.group(2)
        s = s[: m.start()] + "\n" + m.group(1) + inner.lstrip("\n") + s[m.end() :]
    if s != orig:
        p.write_text(s, encoding="utf-8")
        return True
    return False

def main():
    n = 0
    for p in ROOT.rglob("*.tsx"):
        if p.name != "page.tsx" and p.name != "loading.tsx":
            continue
        if strip_file(p):
            print(p.relative_to(ROOT.parent.parent))
            n += 1
    print("updated", n, "files")

if __name__ == "__main__":
    main()
