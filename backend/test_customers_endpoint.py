"""
Quick test script to check if customers endpoint works
Run this to diagnose backend issues
"""
import requests
import json

BASE_URL = "https://api.mahasoftcorporation.com/api"

def test_backend():
    print("=" * 60)
    print("Testing Backend Endpoints")
    print("=" * 60)
    
    # Test 1: Health check
    print("\n1. Testing /health endpoint...")
    try:
        response = requests.get("https://api.mahasoftcorporation.com/health", timeout=5)
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.json()}")
    except Exception as e:
        print(f"   ❌ FAILED: {e}")
        print("   Backend is not running or not accessible!")
        return False
    
    # Test 2: Test customers endpoint (no auth)
    print("\n2. Testing /customers/test endpoint...")
    try:
        response = requests.get(f"{BASE_URL}/customers/test", timeout=5)
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.json()}")
    except Exception as e:
        print(f"   ❌ FAILED: {e}")
    
    print("\n" + "=" * 60)
    print("If health check passed, backend is running!")
    print("If customers/test failed, check the endpoint implementation.")
    print("=" * 60)
    
    return True

if __name__ == "__main__":
    test_backend()

