"""
Test Login Endpoint
"""
import requests
import json

def test_login():
    """Test admin login"""
    url = "https://api.mahasoftcorporation.com/api/auth/login"
    
    # Test data
    data = {
        "username": "admin",
        "password": "admin123"
    }
    
    try:
        print("Testing login endpoint...")
        print(f"URL: {url}")
        print(f"Username: {data['username']}")
        print("\nSending request...")
        
        response = requests.post(
            url,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        
        print(f"\nStatus Code: {response.status_code}")
        print(f"Response Headers: {dict(response.headers)}")
        
        if response.status_code == 200:
            result = response.json()
            print("\n✅ LOGIN SUCCESSFUL!")
            print(f"Access Token: {result.get('access_token', '')[:50]}...")
            print(f"Token Type: {result.get('token_type')}")
            if 'user' in result:
                print(f"User: {result['user'].get('username')} ({result['user'].get('role')})")
        else:
            print(f"\n❌ LOGIN FAILED")
            try:
                error = response.json()
                print(f"Error: {error.get('detail', 'Unknown error')}")
            except:
                print(f"Error: {response.text}")
                
    except requests.exceptions.ConnectionError:
        print("\n❌ ERROR: Cannot connect to backend server")
        print("Make sure the backend is running on https://api.mahasoftcorporation.com")
        print("\nTo start the backend, run:")
        print("  cd backend")
        print("  python -m uvicorn app.main:app --reload")
    except Exception as e:
        print(f"\n❌ ERROR: {type(e).__name__}: {str(e)}")

if __name__ == "__main__":
    test_login()



