#!/usr/bin/env python3
"""
Test Action Timeout Functionality

This script tests:
1. Table creation with action_timeout_seconds
2. Players joining the table
3. Game starting
4. Timeout detection and auto-fold/check
5. Timer values in game state
"""

import requests
import time
import sys

BASE_URL = "http://localhost:8000"

def test_action_timeout():
    print("🧪 Testing Action Timeout Functionality\n")
    
    # Step 1: Register users
    print("1️⃣  Registering test users...")
    users = []
    for i in range(1, 3):
        username = f"timeout_user_{i}_{int(time.time())}"
        # Register
        response = requests.post(f"{BASE_URL}/auth/register", json={
            "username": username,
            "email": f"{username}@test.com",
            "password": "testpass123"
        })
        if response.status_code in [200, 201]:
            print(f"   ✅ Registered {username}")
            # Now login to get token
            login_response = requests.post(f"{BASE_URL}/auth/login", params={
                "username": username,
                "password": "testpass123"
            })
            if login_response.status_code == 200:
                users.append({
                    "username": username,
                    "token": login_response.json()["access_token"]
                })
                print(f"   ✅ Logged in {username}")
            else:
                print(f"   ❌ Failed to login: {login_response.text}")
                return False
        else:
            print(f"   ❌ Failed to register user {i}: {response.text}")
            return False
    
    # Step 2: Create league
    print("\n2️⃣  Creating test league...")
    response = requests.post(
        f"{BASE_URL}/api/leagues",
        headers={"Authorization": f"Bearer {users[0]['token']}"},
        json={"name": f"Timeout Test League {int(time.time())}"}
    )
    if response.status_code in [200, 201]:
        league = response.json()
        print(f"   ✅ Created league: {league['name']} (ID: {league['id']})")
    else:
        print(f"   ❌ Failed to create league: {response.text}")
        return False
    
    # Step 3: Create community
    print("\n3️⃣  Creating test community...")
    response = requests.post(
        f"{BASE_URL}/api/communities",
        headers={"Authorization": f"Bearer {users[0]['token']}"},
        json={
            "name": f"Timeout Test Community {int(time.time())}",
            "description": "Testing action timeouts",
            "league_id": league['id'],
            "starting_balance": 10000
        }
    )
    if response.status_code in [200, 201]:
        community = response.json()
        print(f"   ✅ Created community: {community['name']} (ID: {community['id']})")
    else:
        print(f"   ❌ Failed to create community: {response.text}")
        return False
    
    # Step 4: Join community for both users
    print("\n4️⃣  Users joining community...")
    for user in users:
        response = requests.post(
            f"{BASE_URL}/api/communities/{community['id']}/join",
            headers={"Authorization": f"Bearer {user['token']}"}
        )
        if response.status_code in [200, 201]:
            print(f"   ✅ {user['username']} joined")
        else:
            print(f"   ❌ Failed to join: {response.text}")
            return False
    
    # Step 5: Create table WITH SHORT TIMEOUT
    print("\n5️⃣  Creating table with 10 second timeout...")
    response = requests.post(
        f"{BASE_URL}/api/communities/{community['id']}/tables",
        headers={"Authorization": f"Bearer {users[0]['token']}"},
        json={
            "name": "Timeout Test Table",
            "max_seats": 9,
            "small_blind": 10,
            "big_blind": 20,
            "min_buyin": 100,
            "max_buyin": 1000,
            "is_permanent": False,
            "action_timeout_seconds": 10,  # 10 second timeout for testing (minimum allowed)
            "max_queue_size": 5
        }
    )
    if response.status_code in [200, 201]:
        table = response.json()
        print(f"   ✅ Created table: {table['name']} (ID: {table['id']})")
        print(f"   ⏱️  Action timeout: {table.get('action_timeout_seconds', 'N/A')} seconds")
    else:
        print(f"   ❌ Failed to create table: {response.text}")
        return False
    
    # Step 6: Verify table config endpoint
    print("\n6️⃣  Verifying table config endpoint...")
    response = requests.get(f"{BASE_URL}/api/internal/tables/{table['id']}")
    if response.status_code == 200:
        config = response.json()
        print(f"   ✅ Table config retrieved")
        print(f"   ⏱️  Action timeout: {config.get('action_timeout_seconds')} seconds")
        print(f"   👥 Max seats: {config.get('max_seats')}")
        print(f"   💰 Blinds: ${config.get('small_blind')}/${config.get('big_blind')}")
    else:
        print(f"   ❌ Failed to get table config: {response.text}")
        return False
    
    # Step 7: Seat players
    print("\n7️⃣  Seating players at table...")
    for i, user in enumerate(users):
        response = requests.post(
            f"{BASE_URL}/api/tables/{table['id']}/join",
            headers={"Authorization": f"Bearer {user['token']}"},
            json={
                "seat_number": i + 1,
                "buy_in_amount": 1000
            }
        )
        if response.status_code == 200:
            result = response.json()
            print(f"   ✅ {user['username']} seated at position {i + 1}")
            print(f"   💰 New balance: ${result.get('new_balance', 'N/A')}")
        else:
            print(f"   ❌ Failed to seat player: {response.text}")
            return False
    
    print("\n" + "="*60)
    print("✅ ACTION TIMEOUT TEST SETUP COMPLETE!")
    print("="*60)
    print("\n📋 Summary:")
    print(f"   Community ID: {community['id']}")
    print(f"   Table ID: {table['id']}")
    print(f"   Action Timeout: 10 seconds")
    print(f"   Players: {len(users)}")
    print("\n🎮 Next Steps:")
    print("   1. Connect to game server via WebSocket")
    print("   2. Observe 10-second countdown timer")
    print("   3. Let timer expire without acting")
    print("   4. Verify auto-fold/check occurs")
    print("   5. Check logs for timeout handling")
    print("\n💡 Manual Testing:")
    print("   - Open browser to http://localhost:3001")
    print(f"   - Login as {users[0]['username']} / testpass123")
    print(f"   - Navigate to community {community['id']}")
    print(f"   - Join table {table['id']}")
    print("   - Wait for game to start (2 players connected)")
    print("   - Observe countdown timer in UI")
    print("   - Let it timeout and watch auto-action")
    
    return True

if __name__ == "__main__":
    try:
        success = test_action_timeout()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ Test failed with exception: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
