"""
Add employee_id to employee_business_cards (SQLite ALTER).

If your DB was created before user_id became nullable, delete the SQLite file and
run init_db + seed again, or use Alembic to alter user_id to NULL.

Safe to re-run.
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
        r = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='employee_business_cards'")
        )
        if not r.fetchone():
            print("Table employee_business_cards does not exist yet — run init_db / create_all first.")
            return
        if not column_exists(conn, "employee_business_cards", "employee_id"):
            conn.execute(
                text(
                    "ALTER TABLE employee_business_cards ADD COLUMN employee_id INTEGER REFERENCES employees(id)"
                )
            )
            conn.commit()
            print("Added column employee_id")
        else:
            print("Skip employee_id (exists)")
    print("Done. If inserts fail with NOT NULL user_id, recreate the DB or migrate user_id to nullable.")


if __name__ == "__main__":
    run()
