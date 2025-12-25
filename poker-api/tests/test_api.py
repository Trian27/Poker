#!/usr/bin/env python3
"""
Test script to verify the API is working correctly
"""
import requests
import json

BASE_URL = "http://localhost:8000"

def test_health():
    """Test health check"""
    print("🔍 Testing health check...")
    response = requests.get(f"{BASE_URL}/")
    print(f"   Status: {response.status_code}")
    print(f"   Response: {response.json()}")
    assert response.status_code == 200
    print("   ✅ Health check passed!\n")

def test_register():
    """Test user registration"""
    print("👤 Testing user registration...")
    data = {
        "username": "alice",
        "email": "alice@example.com",
        "password": "password123"
    }
    response = requests.post(f"{BASE_URL}/auth/register", json=data)
    print(f"   Status: {response.status_code}")
    if response.status_code == 201:
        print(f"   Response: {json.dumps(response.json(), indent=2)}")
        print("   ✅ Registration passed!\n")
        return response.json()
    else:
        print(f"   ❌ Registration failed: {response.text}\n")
        return None

def test_login(username, password):
    """Test user login"""
    print("🔐 Testing user login...")
    data = {"username": username, "password": password}
    response = requests.post(
        f"{BASE_URL}/auth/login",
        params=data
    )
    print(f"   Status: {response.status_code}")
    if response.status_code == 200:
        result = response.json()
        print(f"   Token: {result['access_token'][:50]}...")
        print("   ✅ Login passed!\n")
        return result['access_token']
    else:
        print(f"   ❌ Login failed: {response.text}\n")
        return None

def test_create_league(token):
    """Test league creation"""
    print("🏆 Testing league creation...")
    data = {
        "name": "Friday Night Poker",
        "description": "Weekly poker games with friends"
    }
    response = requests.post(
        f"{BASE_URL}/api/leagues",
        json=data,
        params={"token": token}
    )
    print(f"   Status: {response.status_code}")
    if response.status_code == 201:
        print(f"   Response: {json.dumps(response.json(), indent=2)}")
        print("   ✅ League creation passed!\n")
        return response.json()
    else:
        print(f"   ❌ League creation failed: {response.text}\n")
        return None

def test_create_community(token, league_id):
    """Test community creation"""
    print("🏘️  Testing community creation...")
    data = {
        "name": "Main Room",
        "description": "Main playing room",
        "league_id": league_id,
        "starting_balance": 1000.00
    }
    response = requests.post(
        f"{BASE_URL}/api/communities",
        json=data,
        params={"token": token}
    )
    print(f"   Status: {response.status_code}")
    if response.status_code == 201:
        print(f"   Response: {json.dumps(response.json(), indent=2)}")
        print("   ✅ Community creation passed!\n")
        return response.json()
    else:
        print(f"   ❌ Community creation failed: {response.text}\n")
        return None

def test_join_community(token, community_id):
    """Test joining a community"""
    print("💰 Testing join community (creates wallet)...")
    response = requests.post(
        f"{BASE_URL}/api/communities/{community_id}/join",
        params={"token": token}
    )
    print(f"   Status: {response.status_code}")
    if response.status_code == 200:
        print(f"   Response: {json.dumps(response.json(), indent=2)}")
        print("   ✅ Join community passed!\n")
        return response.json()
    else:
        print(f"   ❌ Join community failed: {response.text}\n")
        return None

def test_get_wallets(token):
    """Test getting user wallets"""
    print("💳 Testing get wallets...")
    response = requests.get(
        f"{BASE_URL}/api/wallets",
        params={"token": token}
    )
    print(f"   Status: {response.status_code}")
    if response.status_code == 200:
        print(f"   Response: {json.dumps(response.json(), indent=2)}")
        print("   ✅ Get wallets passed!\n")
        return response.json()
    else:
        print(f"   ❌ Get wallets failed: {response.text}\n")
        return None

def main():
    print("=" * 60)
    print("🎰 POKER PLATFORM API TEST SUITE 🎰")
    print("=" * 60)
    print()

    try:
        # Test 1: Health check
        test_health()

        # Test 2: Register user
        user = test_register()
        if not user:
            print("❌ Cannot continue without user registration")
            return

        # Test 3: Login
        token = test_login("alice", "password123")
        if not token:
            print("❌ Cannot continue without login")
            return

        # Test 4: Create league
        league = test_create_league(token)
        if not league:
            print("❌ Cannot continue without league")
            return

        # Test 5: Create community
        community = test_create_community(token, league['id'])
        if not community:
            print("❌ Cannot continue without community")
            return

        # Test 6: Join community
        wallet = test_join_community(token, community['id'])
        if not wallet:
            print("❌ Cannot continue without wallet")
            return

        # Test 7: Get wallets
        wallets = test_get_wallets(token)

        print("=" * 60)
        print("🎉 ALL TESTS PASSED! 🎉")
        print("=" * 60)
        print()
        print("📊 Summary:")
        print(f"   User ID: {user['id']}")
        print(f"   Username: {user['username']}")
        print(f"   League: {league['name']} (ID: {league['id']})")
        print(f"   Community: {community['name']} (ID: {community['id']})")
        print(f"   Wallet Balance: ${wallet['balance']}")
        print()

    except requests.exceptions.ConnectionError:
        print("❌ ERROR: Cannot connect to API server at http://localhost:8000")
        print("   Make sure the server is running:")
        print("   cd /Users/trian/Projects/poker-api")
        print("   uvicorn app.main:app --reload --port 8000")
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
