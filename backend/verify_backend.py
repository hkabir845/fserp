"""
Verify Backend is Running and Accessible
"""
import requests
import sys

def verify_backend():
    print("=" * 60)
    print("Backend Verification Test")
    print("=" * 60)
    print()
    
    # Test 1: Health endpoint
    print("1. Testing /health endpoint...")
    try:
        response = requests.get('https://api.mahasoftcorporation.com/health', timeout=5)
        if response.status_code == 200:
            print(f"   ✅ Status: {response.status_code}")
            print(f"   ✅ Response: {response.json()}")
        else:
            print(f"   ❌ Status: {response.status_code}")
            sys.exit(1)
    except requests.exceptions.ConnectionError:
        print("   ❌ Cannot connect to backend!")
        print("   💡 Start backend with: python -m uvicorn app.main:app --reload")
        sys.exit(1)
    except Exception as e:
        print(f"   ❌ Error: {e}")
        sys.exit(1)
    
    print()
    
    # Test 2: CORS (including preflight for X-Selected-Company-Id — must match production browser)
    print("2. Testing CORS configuration...")
    try:
        response = requests.options(
            'https://api.mahasoftcorporation.com/api/auth/login',
            headers={
                'Origin': 'http://localhost:3000',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'authorization, content-type, x-selected-company-id',
            },
            timeout=5,
        )
        cors_headers = {k: v for k, v in response.headers.items() if 'access-control' in k.lower()}
        allow = (response.headers.get('Access-Control-Allow-Headers') or '').lower()
        if cors_headers:
            print("   ✅ CORS headers present:")
            for k, v in list(cors_headers.items())[:5]:
                print(f"      {k}: {v}")
        else:
            print("   ⚠️  No CORS headers found")
        if 'x-selected-company-id' in allow:
            print("   ✅ Preflight allows x-selected-company-id (production SPA)")
        else:
            print("   ❌ Preflight missing x-selected-company-id in Access-Control-Allow-Headers")
            print("      Fix: deploy latest fsms/settings.py CORS_ALLOW_HEADERS; check nginx is not overriding CORS.")
    except Exception as e:
        print(f"   ⚠️  CORS test failed: {e}")
    
    print()
    
    # Test 3: Login endpoint
    print("3. Testing /api/auth/login endpoint...")
    try:
        response = requests.post(
            'https://api.mahasoftcorporation.com/api/auth/login',
            data={'username': 'admin', 'password': 'admin123'},
            headers={'Origin': 'http://localhost:3000'},
            timeout=5
        )
        if response.status_code == 200:
            data = response.json()
            if 'access_token' in data:
                print(f"   ✅ Status: {response.status_code}")
                print(f"   ✅ Login successful - Token received")
            else:
                print(f"   ⚠️  Status: {response.status_code} but no token")
        else:
            print(f"   ❌ Status: {response.status_code}")
            print(f"   Response: {response.text[:200]}")
    except Exception as e:
        print(f"   ❌ Error: {e}")
    
    print()
    print("=" * 60)
    print("✅ Backend is running and accessible!")
    print("=" * 60)
    print()
    print("Next steps:")
    print("1. Make sure frontend is running: cd frontend && npm run dev")
    print("2. Clear browser cache or use incognito mode")
    print("3. Go to: http://localhost:3000/login")
    print()

if __name__ == "__main__":
    verify_backend()


