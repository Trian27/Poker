#!/usr/bin/env python3
"""
WebSocket Agent End-to-End Test

This script tests the new WebSocket-based agent by:
1. Creating a test user and getting a JWT token
2. Creating a league and community
3. Creating a poker table
4. Joining the table with buy-in
5. Connecting the WebSocket agent
6. Simulating game actions

Run this after starting all services (Docker or manual).
"""

import requests
import sys
import time
from jose import jwt
from agent_websocket import WebSocketPokerAgent

# Configuration
AUTH_API_URL = "http://localhost:8000"
GAME_SERVER_URL = "http://localhost:3000"

def test_websocket_agent():
    """Complete end-to-end test of WebSocket agent"""
    
    print("=" * 60)
    print("WebSocket Agent End-to-End Test")
    print("=" * 60)
    print()
    
    # Step 1: Register user
    print("📝 Step 1: Registering test user...")
    username = f"bot_test_{int(time.time())}"
    password = "testpass123"  # Min 8 characters
    email = f"{username}@test.com"
    
    register_response = requests.post(
        f"{AUTH_API_URL}/auth/register",
        json={
            "username": username,
            "password": password,
            "email": email
        }
    )
    
    if register_response.status_code != 201:
        print(f"❌ Failed to register: {register_response.text}")
        return False
    
    print(f"✅ User registered: {username}")
    
    # Step 2: Login
    print("\n🔐 Step 2: Logging in...")
    login_response = requests.post(
        f"{AUTH_API_URL}/auth/login",
        params={
            "username": username,
            "password": password
        }
    )
    
    if login_response.status_code != 200:
        print(f"❌ Failed to login: {login_response.text}")
        return False
    
    token = login_response.json()["access_token"]
    
    # Decode token to get user_id (no key verification needed for testing)
    decoded = jwt.decode(token, key="", options={"verify_signature": False})
    user_id = decoded["user_id"]
    
    print(f"✅ Logged in (User ID: {user_id})")
    
    # Step 3: Create league
    print("\n🏆 Step 3: Creating league...")
    league_response = requests.post(
        f"{AUTH_API_URL}/api/leagues",
        params={"token": token},
        json={
            "name": f"Test League {int(time.time())}",
            "description": "Test league for WebSocket agent"
        }
    )
    
    if league_response.status_code != 201:
        print(f"❌ Failed to create league: {league_response.text}")
        return False
    
    league_id = league_response.json()["id"]
    print(f"✅ League created (ID: {league_id})")
    
    # Step 4: Create community
    print("\n🏘️  Step 4: Creating community...")
    community_response = requests.post(
        f"{AUTH_API_URL}/api/communities",
        params={"token": token},
        json={
            "name": f"Test Community {int(time.time())}",
            "description": "Test community for WebSocket agent",
            "league_id": league_id,
            "starting_balance": 10000
        }
    )
    
    if community_response.status_code != 201:
        print(f"❌ Failed to create community: {community_response.text}")
        return False
    
    community_id = community_response.json()["id"]
    print(f"✅ Community created (ID: {community_id})")
    
    # Step 5: Join community (creates wallet)
    print("\n💰 Step 5: Joining community (creates wallet)...")
    join_response = requests.post(
        f"{AUTH_API_URL}/api/communities/{community_id}/join",
        params={"token": token}
    )
    
    if join_response.status_code != 200:
        print(f"❌ Failed to join community: {join_response.text}")
        return False
    
    wallet_balance = join_response.json()["balance"]
    print(f"✅ Joined community (Wallet balance: {wallet_balance})")
    
    # Step 6: Create table
    print("\n🎲 Step 6: Creating poker table...")
    table_response = requests.post(
        f"{AUTH_API_URL}/api/communities/{community_id}/tables",
        params={"token": token},
        json={
            "name": f"WebSocket Test Table {int(time.time())}",
            "game_type": "cash",
            "max_seats": 6,
            "small_blind": 5,
            "big_blind": 10,
            "buy_in": 500
        }
    )
    
    if table_response.status_code != 201:
        print(f"❌ Failed to create table: {table_response.text}")
        return False
    
    table_id = table_response.json()["id"]
    game_id = f"game-{table_id}"
    print(f"✅ Table created (ID: {table_id}, Game ID: {game_id})")
    
    # Step 7: Join table with buy-in
    print("\n💵 Step 7: Joining table with buy-in...")
    join_table_response = requests.post(
        f"{AUTH_API_URL}/api/tables/{table_id}/join",
        params={"token": token},
        json={"buy_in_amount": 500}
    )
    
    if join_table_response.status_code != 200:
        print(f"❌ Failed to join table: {join_table_response.text}")
        return False
    
    new_balance = join_table_response.json()["new_balance"]
    print(f"✅ Joined table (New wallet balance: {new_balance})")
    
    # Step 8: Connect WebSocket agent
    print("\n🤖 Step 8: Testing WebSocket connection...")
    print("=" * 60)
    print()
    
    try:
        agent = WebSocketPokerAgent(
            token=token,
            game_id=game_id,
            user_id=user_id,
            server_url=GAME_SERVER_URL
        )
        
        # Connect in a separate thread to test connection
        import threading
        def connect_agent():
            agent.connect_and_play()
        
        agent_thread = threading.Thread(target=connect_agent, daemon=True)
        agent_thread.start()
        
        # Wait 5 seconds to see if connection works
        print("⏳ Waiting 5 seconds to verify connection...")
        time.sleep(5)
        
        if agent.connected:
            print("\n✅ SUCCESS! WebSocket agent:")
            print("   ✓ Connected to game server")
            print("   ✓ Authenticated successfully") 
            print("   ✓ Ready to receive game events")
            print(f"   ✓ Listening on game: {game_id}")
            print("\n💡 To see the agent play, add more players to the table")
            print(f"   Game ID: {game_id}")
            print(f"   Table ID: {table_id}")
            return True
        else:
            print("\n❌ Agent failed to connect within 5 seconds")
            return False
            
    except Exception as e:
        print(f"\n❌ Agent error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    try:
        success = test_websocket_agent()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n👋 Test interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
