"""
Helper script to debug the daily summary report without the frontend.
"""

from __future__ import annotations

import asyncio
import traceback
from datetime import date

from app.database import SessionLocal
from app.models.user import User
from app.api.reports import get_daily_summary_report


async def run_report(report_date: date) -> None:
    session = SessionLocal()
    try:
        user = session.query(User).filter(User.username == "admin").first()
        if user is None:
            print("Admin user not found.")
            return

        result = await get_daily_summary_report(
            report_date=report_date,
            current_user=user,
            db=session,
        )
        print("Report generated successfully:")
        print(result)
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {type(exc).__name__}: {exc}")
        traceback.print_exc()
    finally:
        session.close()


if __name__ == "__main__":
    asyncio.run(run_report(date(2025, 11, 11)))

