"""
Verify Backend is Running and Accessible (Django — use HTTP with runserver).
"""
import os
import sys

import requests

# Avoid Unicode in prints (Windows cp1252 consoles).
OK = "[OK]"
FAIL = "[FAIL]"
TIP = "Tip:"


def _base_url() -> str:
    return (os.environ.get("VERIFY_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")


def _proxies() -> dict | None:
    """Do not use HTTP(S)_PROXY for localhost checks (avoids bad proxies / wrong ports)."""
    return {"http": None, "https": None}


def verify_backend():
    base = _base_url()
    print("=" * 60)
    print("Backend Verification Test")
    print(f"Base URL: {base} (set VERIFY_BACKEND_URL to override)")
    print("=" * 60)
    print()

    # Test 1: Health endpoint
    print("1. Testing /health endpoint...")
    try:
        response = requests.get(
            f"{base}/health/", timeout=8, proxies=_proxies()
        )
        if response.status_code == 200:
            print(f"   {OK} Status: {response.status_code}")
            print(f"   {OK} Response: {response.json()}")
        else:
            print(f"   {FAIL} Status: {response.status_code}")
            sys.exit(1)
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
        print(f"   {FAIL} Cannot reach backend: {e}")
        print(
            f"   {TIP} Start Django: python manage.py runserver  (then re-run this script)"
        )
        sys.exit(1)
    except Exception as e:
        print(f"   {FAIL} Error: {e}")
        sys.exit(1)

    print()

    # Test 2: CORS (preflight for tenant + report station headers)
    print("2. Testing CORS configuration...")
    try:
        response = requests.options(
            f"{base}/api/auth/login",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": (
                    "authorization, content-type, x-selected-company-id, x-selected-station-id"
                ),
            },
            timeout=8,
            proxies=_proxies(),
        )
        cors_headers = {k: v for k, v in response.headers.items() if "access-control" in k.lower()}
        allow = (response.headers.get("Access-Control-Allow-Headers") or "").lower()
        if cors_headers:
            print(f"   {OK} CORS headers present:")
            for k, v in list(cors_headers.items())[:5]:
                print(f"      {k}: {v}")
        else:
            print("   [WARN] No CORS headers found")
        if "x-selected-company-id" in allow:
            print(f"   {OK} Preflight allows x-selected-company-id")
        else:
            print(f"   {FAIL} Preflight missing x-selected-company-id in Access-Control-Allow-Headers")
        if "x-selected-station-id" in allow:
            print(f"   {OK} Preflight allows x-selected-station-id")
        else:
            print(f"   {FAIL} Preflight missing x-selected-station-id in Access-Control-Allow-Headers")
    except Exception as e:
        print(f"   [WARN] CORS test failed: {e}")

    print()

    # Test 3: Login endpoint
    print("3. Testing /api/auth/login endpoint...")
    try:
        response = requests.post(
            f"{base}/api/auth/login",
            data={"username": "admin", "password": "admin123"},
            headers={"Origin": "http://localhost:3000"},
            timeout=8,
            proxies=_proxies(),
        )
        if response.status_code == 200:
            data = response.json()
            if "access_token" in data:
                print(f"   {OK} Status: {response.status_code}")
                print(f"   {OK} Login successful - token received")
            else:
                print(f"   [WARN] Status: {response.status_code} but no token")
        else:
            print(f"   {FAIL} Status: {response.status_code}")
            print(f"   Response: {response.text[:200]}")
    except Exception as e:
        print(f"   {FAIL} Error: {e}")

    print()
    print("=" * 60)
    print(f"{OK} Basic checks completed.")
    print("=" * 60)
    print()
    print("Next steps:")
    print("1. Make sure frontend is running: cd frontend && npm run dev")
    print("2. Clear browser cache or use incognito mode")
    print("3. Go to: http://localhost:3000/login")
    print()


if __name__ == "__main__":
    verify_backend()
