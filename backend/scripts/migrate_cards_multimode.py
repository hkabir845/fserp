"""
Add multimode NFC / digital card columns to existing SQLite DBs (safe to re-run).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.db.session import engine


def column_exists(conn, table: str, col: str) -> bool:
    r = conn.execute(text(f"PRAGMA table_info({table})"))
    return any(row[1] == col for row in r.fetchall())


def run():
    with engine.connect() as conn:
        r = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='employee_business_cards'"))
        if not r.fetchone():
            print("Table employee_business_cards does not exist yet — run app init_db / create_all first.")
            return
    alters = [
        ("role_business_card", "BOOLEAN DEFAULT 1"),
        ("role_employee_id", "BOOLEAN DEFAULT 1"),
        ("role_access", "BOOLEAN DEFAULT 0"),
        ("role_payment", "BOOLEAN DEFAULT 0"),
        ("employee_code", "VARCHAR"),
        ("photo_url", "VARCHAR"),
        ("join_date", "DATETIME"),
        ("blood_group", "VARCHAR"),
        ("emergency_contact_name", "VARCHAR"),
        ("emergency_contact_phone", "VARCHAR"),
        ("profile_notes", "TEXT"),
        ("access_zones_json", "TEXT"),  # JSON array as text in SQLite
        ("access_valid_from", "DATETIME"),
        ("access_valid_to", "DATETIME"),
        ("access_notes", "TEXT"),
        ("payment_enrolled", "BOOLEAN DEFAULT 0"),
        ("payment_provider_ref", "VARCHAR"),
        ("payment_last4_hint", "VARCHAR"),
        ("payment_notes", "TEXT"),
    ]
    with engine.connect() as conn:
        for col, typ in alters:
            if not column_exists(conn, "employee_business_cards", col):
                conn.execute(text(f"ALTER TABLE employee_business_cards ADD COLUMN {col} {typ}"))
                conn.commit()
                print(f"Added column {col}")
            else:
                print(f"Skip {col} (exists)")
    print("Done.")


if __name__ == "__main__":
    run()
