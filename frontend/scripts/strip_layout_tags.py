"""Remove remaining Layout import and <Layout> tags from pages (AppShell provides shell)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "src" / "app"

def clean(s: str) -> str:
    s = s.replace("import { Layout } from '@/components/Layout'\n", "")
    s = s.replace('import { Layout } from "@/components/Layout"\n', "")
    while "<Layout>" in s:
        s = s.replace("<Layout>", "", 1)
    while "</Layout>" in s:
        s = s.replace("</Layout>", "", 1)
    return s

def main():
    for p in ROOT.rglob("page.tsx"):
        o = p.read_text(encoding="utf-8")
        if "from '@/components/Layout'" not in o and 'from "@/components/Layout"' not in o:
            continue
        n = clean(o)
        if n != o:
            p.write_text(n, encoding="utf-8")
            print(p.relative_to(ROOT.parent.parent))

if __name__ == "__main__":
    main()
