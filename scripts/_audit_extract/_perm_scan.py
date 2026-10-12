from pathlib import Path
import re

views = Path(r"I:/ITProjects/FSERP/backend/api/views")
for p in sorted(views.glob("*.py")):
    if p.name in ("common.py", "__init__.py"):
        continue
    text = p.read_text(encoding="utf-8", errors="replace")
    if "@require_permission" in text:
        continue
    has_mutate = bool(re.search(r"request\.method.*(POST|PUT|PATCH|DELETE)", text))
    defs = re.findall(r"^def (\w+)", text, re.M)
    print(f"{p.name}: mutate~={has_mutate} defs={len(defs)}")
