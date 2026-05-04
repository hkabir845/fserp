"""
End-to-end smoke tests for ERP Filling Station backend roles and POS data.
"""

from __future__ import annotations

import json
import sys
from typing import Iterable, Tuple

import requests

BASE_URL = "https://localhost:8000"


def fetch_token(username: str, password: str) -> str:
    resp = requests.post(
        f"{BASE_URL}/api/auth/login",
        data={"username": username, "password": password},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"Login succeeded but no token for user '{username}'")
    return token


def get_json(path: str, token: str) -> Tuple[int, str, object]:
    url = f"{BASE_URL}{path}"
    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=10)
    body = ""
    try:
        data = resp.json()
    except json.JSONDecodeError:
        data = None
        body = resp.text
    return resp.status_code, body, data


def summarize_payload(data: object) -> str:
    if isinstance(data, dict):
        return f"keys={list(data.keys())[:5]}"
    if isinstance(data, list):
        return f"items={len(data)}"
    return type(data).__name__


def check_endpoints(label: str, token: str, endpoints: Iterable[Tuple[str, str]]) -> None:
    print(f"\n=== {label} ===")
    for name, path in endpoints:
        try:
            status, raw, data = get_json(path, token)
            if status == 200 and data is not None:
                print(f"[OK] {name:<25} {status}  {summarize_payload(data)}")
            else:
                snippet = raw[:180].replace("\n", " ")
                print(f"[!!] {name:<25} {status}  {snippet or '<non-JSON response>'}")
        except Exception as exc:  # noqa: BLE001
            print(f"[XX] {name:<25} ERROR {exc}")


def main() -> int:
    print("ERP Filling Station :: Backend role verification\n")

    try:
        admin_token = fetch_token("admin", "admin123")
        cashier_token = fetch_token("cashier", "cashier123")
        accountant_token = fetch_token("accountant", "accountant123")
    except Exception as exc:  # noqa: BLE001
        print(f"Login failure: {exc}")
        return 1

    admin_paths = [
        ("Nozzles details", "/api/nozzles/details"),
        ("POS items", "/api/items/?pos_only=true"),
        ("All items", "/api/items/"),
        ("Tanks", "/api/tanks/"),
        ("Recent sales", "/api/cashier/sales/recent"),
    ]
    check_endpoints("Admin endpoints", admin_token, admin_paths)

    accountant_paths = [
        ("Fuel sales report", "/api/reports/fuel-sales"),
        ("Tank inventory", "/api/reports/tank-inventory"),
        ("Shift summary", "/api/reports/shift-summary"),
        ("Sales by nozzle", "/api/reports/sales-by-nozzle"),
        ("Daily summary", "/api/reports/daily-summary"),
    ]
    check_endpoints("Accountant reports", accountant_token, accountant_paths)

    cashier_paths = [
        ("Cashier nozzles", "/api/nozzles"),
        ("Cashier tanks", "/api/tanks/"),
        ("POS items", "/api/items/?pos_only=true"),
    ]
    check_endpoints("Cashier endpoints", cashier_token, cashier_paths)

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

