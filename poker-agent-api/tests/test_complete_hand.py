#!/usr/bin/env python3
"""
Play a complete hand and verify hand history recording
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

def test_complete_hand():
    """Play a complete hand with two bots"""
    
    print("=" * 80)
    print("COMPLETE HAND TEST - WITH HAND HISTORY VERIFICATION")
    print("=" * 80)
    print()
    
    # Create admin user for setup
    timestamp = int(time.time())
    username1 = f"admin_{timestamp}"
    password = "testpass123"
    
    print("📝 Creating admin user...")
    requests.post(
        f"{AUTH_API_URL}/auth/register",
        json={"username": username1, "password": password, "email": f"{username1}@test.com"}
    )
    
    # Login
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
            "name": f"Test League {timestamp}",
            "description": "Complete hand test"
        }
    )
    league_id = league_response.json()["id"]
    
    # Create community
    print("🏘️  Creating community...")
    community_response = requests.post(
        f"{AUTH_API_URL}/api/communities",
        headers=headers,
        json={
            "name": f"Test Community {timestamp}",
            "description": "Complete hand test",
            "league_id": league_id,
            "starting_balance": 10000
        }
    )
    community_id = community_response.json()["id"]
    
    # Create table
    print("🎲 Creating poker table...")
    table_response = requests.post(
        f"{AUTH_API_URL}/api/communities/{community_id}/tables",
        headers=headers,
        json={
            "name": f"Complete Hand Test {timestamp}",
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
    print()
    
    # Create two players
    players = []
    for i in range(1, 3):
        username = f"bot_{timestamp}_p{i}"
        
        # Register
        requests.post(
            f"{AUTH_API_URL}/auth/register",
            json={"username": username, "password": password, "email": f"{username}@test.com"}
        )
        
        # Login
        login_resp = requests.post(
            f"{AUTH_API_URL}/auth/login",
            params={"username": username, "password": password}
        )
        player_token = login_resp.json()["access_token"]
        player_headers = {"Authorization": f"Bearer {player_token}"}
        
        decoded = jwt.decode(player_token, key="", options={"verify_signature": False})
        user_id = decoded["user_id"]
        
        # Join community
        requests.post(
            f"{AUTH_API_URL}/api/communities/{community_id}/join",
            headers=player_headers
        )
        
        # Join table
        requests.post(
            f"{AUTH_API_URL}/api/tables/{table_id}/join",
            headers=player_headers,
            json={"buy_in_amount": 500, "seat_number": i}
        )
        
        players.append({
            "username": username,
            "user_id": user_id,
            "token": player_token
        })
        
        print(f"✅ Created player {i}: {username} (User ID: {user_id})")
    
    print()
    print("🎮 Starting game agents...")
    print()
    
    # Create agents
    agents = []
    threads = []
    
    for i, player in enumerate(players, 1):
        agent = WebSocketPokerAgent(
            server_url=GAME_SERVER_URL,
            token=player["token"],
            game_id=game_id,
            user_id=player["user_id"]
        )
        agents.append(agent)
        
        def run_agent(a, num):
            print(f"🤖 Player {num} ({player['username']}) connecting...")
            try:
                a.connect_and_play()
            except Exception as e:
                print(f"❌ Player {num} error: {e}")
        
        thread = threading.Thread(target=run_agent, args=(agent, i), daemon=True)
        threads.append(thread)
        thread.start()
    
    # Wait for game to complete
    print("⏳ Waiting for hand to complete (60 seconds)...")
    time.sleep(60)
    
    print()
    print("=" * 80)
    print("CHECKING HAND HISTORY")
    print("=" * 80)
    print()
    
    # Check hand history for both players
    for i, player in enumerate(players, 1):
        print(f"📜 Checking hand history for Player {i} ({player['username']})...")
        headers = {"Authorization": f"Bearer {player['token']}"}
        resp = requests.get(
            f"{AUTH_API_URL}/api/me/hands",
            headers=headers,
            params={"limit": 10}
        )
        
        if resp.status_code == 200:
            hands = resp.json()
            print(f"   ✅ Found {len(hands)} hands")
            
            if len(hands) > 0:
                hand = hands[0]
                print(f"   📋 Latest hand:")
                print(f"      Table: {hand['table_name']}")
                print(f"      Played at: {hand['played_at']}")
                print(f"      Players: {hand['player_count']}")
                print(f"      Pot: {hand['pot_size']} chips")
                if hand.get('winner_username'):
                    print(f"      Winner: {hand['winner_username']}")
                
                # Get full details
                detail_resp = requests.get(
                    f"{AUTH_API_URL}/api/hands/{hand['id']}",
                    headers=headers
                )
                if detail_resp.status_code == 200:
                    details = detail_resp.json()
                    hand_data = details["hand_data"]
                    print(f"      Community Cards: {hand_data.get('community_cards', [])}")
            else:
                print(f"   ⚠️  No hands recorded yet")
        else:
            print(f"   ❌ Failed to get history: {resp.status_code}")
        
        print()
    
    # Check database directly
    print("🗄️  Checking database...")
    import subprocess
    result = subprocess.run(
        ["docker", "exec", "poker-postgres", "psql", "-U", "poker_user", "-d", "poker_db", 
         "-c", "SELECT COUNT(*) as total FROM hand_history;"],
        capture_output=True,
        text=True
    )
    print(result.stdout)
    
    print("=" * 80)
    print("TEST COMPLETE")
    print("=" * 80)
    
    return True

if __name__ == "__main__":
    try:
        test_complete_hand()
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
