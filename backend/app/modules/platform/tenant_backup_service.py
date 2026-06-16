"""
Logical export / restore of a single tenant's rows for SaaS platform operators.

Export uses the live database schema (inspector + raw SQL) so backups still work
when the ORM is slightly ahead of applied migrations. Restore inserts in a
stable order (tenants → roles → users → user_roles → other tables alphabetically)
with SQLite foreign_keys disabled for the operation block.
"""

from __future__ import annotations

import base64
import json
import os
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Tuple

from sqlalchemy import MetaData, Table, inspect, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.sql.sqltypes import Boolean, Date, DateTime, Integer, JSON, Numeric

# Ensure all Table objects are registered on Base.metadata (deserialize / insert)
import app.db.base  # noqa: F401

from app.db.session import Base
from app.core.config import settings


BACKUP_FORMAT_VERSION = 1

SKIP_TABLES = frozenset(
    {
        "platform_users",
        "platform_accounts",
        "platform_journal_entries",
        "platform_journal_lines",
        "platform_settings",
        "currencies",
        "platform_uoms",
        "subscription_plans",
        "platform_broadcasts",
        "alembic_version",
    }
)


def _serialize_value(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, datetime):
        return {"__dt__": v.isoformat()}
    if isinstance(v, date):
        return {"__d__": v.isoformat()}
    if isinstance(v, Decimal):
        return {"__dec__": str(v)}
    if isinstance(v, bytes):
        return {"__bin__": base64.b64encode(v).decode("ascii")}
    if hasattr(v, "value") and hasattr(v, "name"):
        try:
            return {"__enum__": str(v.value)}
        except Exception:
            return {"__enum__": str(v)}
    if isinstance(v, (dict, list)):
        return v
    return v


def _deserialize_value(col_type: Any, v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, dict) and "__dt__" in v:
        s = v["__dt__"]
        if isinstance(s, str):
            if s.endswith("Z"):
                s = s[:-1] + "+00:00"
            return datetime.fromisoformat(s)
        return v
    if isinstance(v, dict) and "__d__" in v:
        return date.fromisoformat(str(v["__d__"]))
    if isinstance(v, dict) and "__dec__" in v:
        return Decimal(str(v["__dec__"]))
    if isinstance(v, dict) and "__bin__" in v:
        return base64.b64decode(str(v["__bin__"]).encode("ascii"))
    if isinstance(v, dict) and "__enum__" in v:
        return v["__enum__"]
    if isinstance(col_type, (JSON,)) and isinstance(v, (dict, list)):
        return v
    if isinstance(col_type, (Integer,)) and isinstance(v, str) and v.isdigit():
        return int(v)
    if isinstance(col_type, (Boolean,)) and isinstance(v, (bool, int)):
        return bool(v)
    if isinstance(col_type, (Numeric,)) and isinstance(v, (str, int, float)):
        return Decimal(str(v))
    if isinstance(col_type, (DateTime, Date)) and isinstance(v, str):
        if "T" in v:
            if v.endswith("Z"):
                v = v[:-1] + "+00:00"
            return datetime.fromisoformat(v)
        return date.fromisoformat(v)
    return v


def _row_to_serializable(row: Dict[str, Any]) -> Dict[str, Any]:
    return {k: _serialize_value(v) for k, v in row.items()}


def _sanitize_filename_part(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", s)[:80]


def _safe_sql_ident(name: str) -> str:
    if not name or not re.match(r"^[a-z0-9_]+$", name):
        raise ValueError(f"Invalid SQL identifier: {name!r}")
    return name


def _tenant_scoped_table_names(conn: Connection) -> List[str]:
    """Physical tables that have a tenant_id column (from live DB)."""
    insp = inspect(conn)
    found: List[str] = []
    for name in insp.get_table_names():
        if name in SKIP_TABLES or name == "tenants":
            continue
        try:
            _safe_sql_ident(name)
        except ValueError:
            continue
        try:
            cols = {c["name"] for c in insp.get_columns(name)}
        except Exception:
            continue
        if "tenant_id" in cols:
            found.append(name)
    return sorted(found)


def _restore_table_order(table_names: Iterable[str]) -> List[str]:
    """Put core identity tables first; remaining tables alphabetically (stable, FK-friendly for typical schemas)."""
    s = set(table_names)
    priority = ["tenants", "roles", "users", "user_roles"]
    head = [x for x in priority if x in s]
    tail = sorted([x for x in s if x not in priority])
    return head + tail


def export_tenant_payload(conn: Connection, tenant_id: int) -> Dict[str, Any]:
    tables_data: Dict[str, List[Dict[str, Any]]] = {}
    skipped: List[Dict[str, str]] = []

    tname = _safe_sql_ident("tenants")
    r = conn.execute(text(f"SELECT * FROM {tname} WHERE id = :id"), {"id": tenant_id}).mappings().first()
    if not r:
        raise ValueError("Tenant not found")
    tenant_row = _row_to_serializable(dict(r))
    tables_data["tenants"] = [tenant_row]

    for name in _tenant_scoped_table_names(conn):
        ident = _safe_sql_ident(name)
        try:
            q = text(f"SELECT * FROM {ident} WHERE tenant_id = :tid")
            rows = conn.execute(q, {"tid": tenant_id}).mappings().all()
        except Exception as e:
            skipped.append({name: str(e)[:500]})
            continue
        if rows:
            tables_data[name] = [_row_to_serializable(dict(x)) for x in rows]

    try:
        q = text(
            """
            SELECT ur.user_id AS user_id, ur.role_id AS role_id
            FROM user_roles ur
            INNER JOIN users u ON u.id = ur.user_id
            WHERE u.tenant_id = :tid
            """
        )
        ur = conn.execute(q, {"tid": tenant_id}).mappings().all()
        if ur:
            tables_data["user_roles"] = [_row_to_serializable(dict(x)) for x in ur]
    except Exception as e:
        skipped.append({"user_roles": str(e)[:500]})

    dom = tenant_row.get("domain")
    tenant_domain_str = dom if isinstance(dom, str) else str(dom or "")
    counts = {k: len(v) for k, v in tables_data.items()}
    out: Dict[str, Any] = {
        "format_version": BACKUP_FORMAT_VERSION,
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "tenant_id": tenant_id,
        "tenant_domain": tenant_domain_str,
        "tables": tables_data,
        "table_row_counts": counts,
    }
    if skipped:
        out["skipped_export_tables"] = skipped
    return out


def _deserialize_row(table: Table, row: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in row.items():
        if k not in table.c:
            continue
        out[k] = _deserialize_value(table.c[k].type, v)
    return out


def restore_tenant_payload(
    conn: Connection,
    engine: Engine,
    tenant_id: int,
    payload: Dict[str, Any],
    *,
    confirm_domain: str,
) -> Tuple[int, Dict[str, int]]:
    if int(payload.get("format_version", 0)) != BACKUP_FORMAT_VERSION:
        raise ValueError(f"Unsupported backup format_version (expected {BACKUP_FORMAT_VERSION})")

    tables = payload.get("tables") or {}
    tenant_rows = tables.get("tenants") or []
    if len(tenant_rows) != 1:
        raise ValueError("Backup must contain exactly one tenants row")
    t0 = tenant_rows[0]
    if int(t0.get("id", -1)) != int(tenant_id):
        raise ValueError("Backup tenant id does not match URL tenant id")

    def _flat_str(v: Any) -> str:
        if v is None:
            return ""
        if isinstance(v, str):
            return v
        if isinstance(v, dict) and "__enum__" in v:
            return str(v["__enum__"])
        return str(v)

    dom_raw = _flat_str(payload.get("tenant_domain")) or _flat_str(t0.get("domain"))
    dom_payload = dom_raw.strip().lower()
    if dom_payload != (confirm_domain or "").strip().lower():
        raise ValueError("confirm_domain does not match backup tenant domain")

    md = Base.metadata
    dialect = engine.dialect.name

    def fk_off() -> None:
        if dialect == "sqlite":
            conn.execute(text("PRAGMA foreign_keys=OFF"))

    def fk_on() -> None:
        if dialect == "sqlite":
            conn.execute(text("PRAGMA foreign_keys=ON"))

    fk_off()
    try:
        conn.execute(
            text("DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE tenant_id = :tid)"),
            {"tid": tenant_id},
        )
        for name in reversed(_tenant_scoped_table_names(conn)):
            ident = _safe_sql_ident(name)
            conn.execute(text(f"DELETE FROM {ident} WHERE tenant_id = :tid"), {"tid": tenant_id})
        conn.execute(text("DELETE FROM users WHERE tenant_id = :tid"), {"tid": tenant_id})
        conn.execute(text("DELETE FROM roles WHERE tenant_id = :tid"), {"tid": tenant_id})
        conn.execute(text("DELETE FROM tenants WHERE id = :tid"), {"tid": tenant_id})

        inserted: Dict[str, int] = {}
        for name in _restore_table_order(tables.keys()):
            if name in SKIP_TABLES:
                continue
            rows = tables.get(name)
            if not rows:
                continue
            table = md.tables.get(name)
            if table is None:
                continue
            n = 0
            for raw in rows:
                data = _deserialize_row(table, raw)
                conn.execute(table.insert().values(**data))
                n += 1
            inserted[name] = n
        return (len(inserted), inserted)
    finally:
        fk_on()


def save_backup_file(tenant_id: int, tenant_domain: str, payload: Dict[str, Any]) -> str:
    root = settings.TENANT_BACKUP_DIR
    os.makedirs(root, exist_ok=True)
    safe_dom = _sanitize_filename_part(tenant_domain or "tenant")
    fn = f"tenant_{tenant_id}_{safe_dom}_{datetime.utcnow().strftime('%Y%m%dT%H%M%S')}.json"
    path = os.path.join(root, fn)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return fn


def list_backup_files(tenant_id: int) -> List[Dict[str, Any]]:
    root = settings.TENANT_BACKUP_DIR
    if not os.path.isdir(root):
        return []
    prefix = f"tenant_{tenant_id}_"
    out: List[Dict[str, Any]] = []
    for name in sorted(os.listdir(root), reverse=True):
        if not name.startswith(prefix) or not name.endswith(".json"):
            continue
        path = os.path.join(root, name)
        try:
            st = os.stat(path)
            out.append(
                {
                    "filename": name,
                    "size_bytes": st.st_size,
                    "modified_at": datetime.utcfromtimestamp(st.st_mtime).isoformat() + "Z",
                }
            )
        except OSError:
            continue
    return out


def resolve_backup_path(tenant_id: int, filename: str) -> str:
    if ".." in filename or "/" in filename or "\\" in filename:
        raise ValueError("Invalid filename")
    if not filename.startswith(f"tenant_{tenant_id}_") or not filename.endswith(".json"):
        raise ValueError("Invalid backup filename for this tenant")
    path = os.path.join(settings.TENANT_BACKUP_DIR, filename)
    if not os.path.isfile(path):
        raise FileNotFoundError("Backup file not found")
    return path
