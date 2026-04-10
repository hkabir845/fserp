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
        response = requests.get('http://localhost:8000/health', timeout=5)
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
    
    # Test 2: CORS
    print("2. Testing CORS configuration...")
    try:
        response = requests.options(
            'http://localhost:8000/api/auth/login',
            headers={
                'Origin': 'http://localhost:3000',
                'Access-Control-Request-Method': 'POST',
            },
            timeout=5
        )
        cors_headers = {k: v for k, v in response.headers.items() if 'access-control' in k.lower()}
        if cors_headers:
            print("   ✅ CORS headers present:")
            for k, v in list(cors_headers.items())[:3]:
                print(f"      {k}: {v}")
        else:
            print("   ⚠️  No CORS headers found")
    except Exception as e:
        print(f"   ⚠️  CORS test failed: {e}")
    
    print()
    
    # Test 3: Login endpoint
    print("3. Testing /api/auth/login endpoint...")
    try:
        response = requests.post(
            'http://localhost:8000/api/auth/login',
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


