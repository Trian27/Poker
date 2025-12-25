#!/usr/bin/env python3
"""
Test two players connecting to verify game start

This test creates two bot accounts, seats them at the same table,
and connects both via WebSocket to verify the game starts automatically.
"""

import requests
import sys
import time
import threading
from jose import jwt
from agent_websocket import WebSocketPokerAgent

# Configuration
AUTH_API_URL = "http://localhost:8000"
GAME_SERVER_URL = "http://localhost:3000"

def create_and_join_player(player_num: int, table_id: int, community_id: int, game_id: str):
    """Create a player, join the table, and connect via WebSocket"""
    
    print(f"\n{'='*60}")
    print(f"Player {player_num} Setup")
    print('='*60)
    
    # Register
    username = f"bot_player_{player_num}_{int(time.time())}"
    password = "testpass123"
    email = f"{username}@test.com"
    
    print(f"📝 Registering {username}...")
    register_response = requests.post(
        f"{AUTH_API_URL}/auth/register",
        json={"username": username, "password": password, "email": email}
    )
    
    if register_response.status_code != 201:
        print(f"❌ Failed to register: {register_response.text}")
        return None
    
    # Login
    print(f"🔐 Logging in...")
    login_response = requests.post(
        f"{AUTH_API_URL}/auth/login",
        params={"username": username, "password": password}
    )
    
    if login_response.status_code != 200:
        print(f"❌ Failed to login: {login_response.text}")
        return None
    
    token = login_response.json()["access_token"]
    decoded = jwt.decode(token, key="", options={"verify_signature": False})
    user_id = decoded["user_id"]
    
    print(f"✅ Logged in (User ID: {user_id})")
    
    headers = {"Authorization": f"Bearer {token}"}
    
    # Join community
    print(f"💰 Joining community...")
    join_response = requests.post(
        f"{AUTH_API_URL}/api/communities/{community_id}/join",
        headers=headers
    )
    
    if join_response.status_code != 200:
        print(f"❌ Failed to join community: {join_response.text}")
        return None
    
    # Join table
    print(f"💵 Joining table {table_id} at seat {player_num}...")
    join_table_response = requests.post(
        f"{AUTH_API_URL}/api/tables/{table_id}/join",
        headers=headers,
        json={"buy_in_amount": 500, "seat_number": player_num}
    )
    
    if join_table_response.status_code != 200:
        print(f"❌ Failed to join table: {join_table_response.text}")
        return None
    
    print(f"✅ Joined table successfully")
    
    # Create and connect WebSocket agent
    agent = WebSocketPokerAgent(
        token=token,
        game_id=game_id,
        user_id=user_id,
        server_url=GAME_SERVER_URL
    )
    
    return agent

def test_two_players():
    """Test game starting with two players"""
    
    print("\n" + "="*60)
    print("Two Player Game Start Test")
    print("="*60)
    
    # Create initial setup (league, community, table)
    print("\n📋 Setting up game environment...")
    
    # Register and login first player to create infrastructure
    username1 = f"setup_bot_{int(time.time())}"
    password = "testpass123"
    email1 = f"{username1}@test.com"
    
    register_response = requests.post(
        f"{AUTH_API_URL}/auth/register",
        json={"username": username1, "password": password, "email": email1}
    )
    
    if register_response.status_code != 201:
        print(f"❌ Failed to register setup user: {register_response.text}")
        return False
    
    login_response = requests.post(
        f"{AUTH_API_URL}/auth/login",
        params={"username": username1, "password": password}
    )
    
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create league
    print("🏆 Creating league...")
    league_response = requests.post(
        f"{AUTH_API_URL}/api/leagues",
        headers=headers,
        json={
            "name": f"Test League {int(time.time())}",
            "description": "Two player test"
        }
    )
    league_id = league_response.json()["id"]
    print(f"✅ League created (ID: {league_id})")
    
    # Create community
    print("🏘️  Creating community...")
    community_response = requests.post(
        f"{AUTH_API_URL}/api/communities",
        headers=headers,
        json={
            "name": f"Test Community {int(time.time())}",
            "description": "Two player test",
            "league_id": league_id,
            "starting_balance": 10000
        }
    )
    community_id = community_response.json()["id"]
    print(f"✅ Community created (ID: {community_id})")
    
    # Create table
    print("🎲 Creating poker table...")
    table_response = requests.post(
        f"{AUTH_API_URL}/api/communities/{community_id}/tables",
        headers=headers,
        json={
            "name": f"Two Player Test {int(time.time())}",
            "game_type": "cash",
            "max_seats": 6,
            "small_blind": 5,
            "big_blind": 10,
            "buy_in": 500
        }
    )
    table_id = table_response.json()["id"]
    game_id = f"table_{table_id}"
    print(f"✅ Table created (ID: {table_id}, Game ID: {game_id})")
    
    # Create two players
    print("\n🤖 Creating and connecting two players...")
    
    agent1 = create_and_join_player(1, table_id, community_id, game_id)
    if not agent1:
        return False
    
    agent2 = create_and_join_player(2, table_id, community_id, game_id)
    if not agent2:
        return False
    
    # Connect both agents in threads
    print("\n🔌 Connecting both agents to game server...")
    
    def connect_agent(agent, player_num):
        print(f"🤖 Player {player_num} connecting...")
        try:
            agent.connect_and_play()
        except Exception as e:
            print(f"❌ Player {player_num} error: {e}")
    
    thread1 = threading.Thread(target=connect_agent, args=(agent1, 1), daemon=True)
    thread2 = threading.Thread(target=connect_agent, args=(agent2, 2), daemon=True)
    
    thread1.start()
    time.sleep(1)  # Stagger connections slightly
    thread2.start()
    
    # Wait for connections and game to start
    print("\n⏳ Waiting 10 seconds for game to start...")
    for i in range(10):
        time.sleep(1)
        if agent1.game_started or agent2.game_started:
            print(f"🎲 Game started after {i+1} seconds!")
            break
    
    # Check results
    print("\n" + "="*60)
    print("Test Results")
    print("="*60)
    
    if agent1.connected and agent2.connected:
        print("✅ Both agents connected successfully")
        
        if agent1.game_started or agent2.game_started:
            print("✅ Game started automatically!")
            print("\n🎉 SUCCESS! Queue system working correctly:")
            print("   ✓ Both players seated")
            print("   ✓ Both players connected")
            print("   ✓ Game started with 2 players")
            return True
        else:
            print("⚠️  Agents connected but game didn't start")
            print("   Check game server logs for details")
            return False
    else:
        print(f"❌ Connection failed:")
        print(f"   Player 1: {'connected' if agent1.connected else 'not connected'}")
        print(f"   Player 2: {'connected' if agent2.connected else 'not connected'}")
        return False

if __name__ == '__main__':
    try:
        success = test_two_players()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n👋 Test interrupted")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
