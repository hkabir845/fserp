"""
Quick test to verify backend is responding
Run this to check if backend is accessible
"""
import requests
import sys

def test_backend():
    print("=" * 60)
    print("Testing Backend Connection")
    print("=" * 60)
    
    base_url = "http://localhost:8000"
    
    # Test 1: Health endpoint (no auth needed)
    print("\n1. Testing /health endpoint...")
    try:
        response = requests.get(f"{base_url}/health", timeout=5)
        print(f"   ✅ Status: {response.status_code}")
        print(f"   Response: {response.json()}")
    except requests.exceptions.ConnectionError:
        print("   ❌ FAILED: Cannot connect to backend")
        print("   Backend is NOT running on http://localhost:8000")
        print("\n   To start backend:")
        print("   - Double-click: START_BACKEND_NOW.bat")
        print("   - Or run: cd backend && python -m uvicorn app.main:app --reload")
        return False
    except requests.exceptions.Timeout:
        print("   ❌ FAILED: Request timed out")
        print("   Backend is running but not responding")
        return False
    except Exception as e:
        print(f"   ❌ FAILED: {e}")
        return False
    
    # Test 2: API docs (no auth needed)
    print("\n2. Testing /api/docs endpoint...")
    try:
        response = requests.get(f"{base_url}/api/docs", timeout=5)
        print(f"   ✅ Status: {response.status_code}")
        if response.status_code == 200:
            print("   API documentation is accessible")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
    
    # Test 3: Test customers endpoint (no auth)
    print("\n3. Testing /api/customers/test endpoint...")
    try:
        response = requests.get(f"{base_url}/api/customers/test", timeout=5)
        print(f"   ✅ Status: {response.status_code}")
        print(f"   Response: {response.json()}")
    except Exception as e:
        print(f"   ⚠️  Warning: {e}")
    
    print("\n" + "=" * 60)
    print("✅ Backend is running and accessible!")
    print("=" * 60)
    return True

if __name__ == "__main__":
    success = test_backend()
    sys.exit(0 if success else 1)

