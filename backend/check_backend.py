"""
Quick script to check if the backend server is running
"""
import sys
try:
    import requests
    response = requests.get('http://127.0.0.1:8000/health', timeout=2)
    if response.status_code == 200:
        print("✅ Backend server is running!")
        print(f"   Response: {response.json()}")
        sys.exit(0)
    else:
        print(f"❌ Backend server returned status {response.status_code}")
        sys.exit(1)
except requests.exceptions.ConnectionError:
    print("❌ Backend server is NOT running!")
    print("   Please start it with: python manage.py runserver 127.0.0.1:8000 (from backend/ with venv active)")
    sys.exit(1)
except requests.exceptions.Timeout:
    print("❌ Backend server is not responding (timeout)")
    sys.exit(1)
except ImportError:
    print("⚠️  requests library not installed. Install with: pip install requests")
    sys.exit(1)
except Exception as e:
    print(f"❌ Error checking backend: {e}")
    sys.exit(1)



