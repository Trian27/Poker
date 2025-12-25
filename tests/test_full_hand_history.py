"""
Complete Hand History Test
This script:
1. Creates test users
2. Creates a community and table
3. Plays a complete hand via WebSocket
4. Verifies the hand history was recorded
5. Retrieves and displays the hand history
"""

import requests
import websockets
import asyncio
import json
import time

BASE_URL = "http://localhost:8000"
WS_URL = "ws://localhost:3000"

def create_user(username: str, password: str):
    """Create a new user account"""
    response = requests.post(f"{BASE_URL}/auth/register", json={
        "username": username,
        "email": f"{username}@test.com",
        "password": password
    })
    return response.status_code in [200, 201]

def login(username: str, password: str):
    """Login and get token"""
    response = requests.post(f"{BASE_URL}/auth/login", params={
        "username": username,
        "password": password
    })
    if response.status_code != 200:
        raise Exception(f"Login failed: {response.text}")
    return response.json()["access_token"]

def create_community(token: str, league_id: int, name: str):
    """Create a community in a league"""
    response = requests.post(
        f"{BASE_URL}/api/communities",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": name,
            "league_id": league_id
        }
    )
    if response.status_code not in [200, 201]:
        raise Exception(f"Failed to create community: {response.text}")
    return response.json()

def create_league(token: str, name: str):
    """Create a league"""
    response = requests.post(
        f"{BASE_URL}/api/leagues",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": name}
    )
    if response.status_code not in [200, 201]:
        raise Exception(f"Failed to create league: {response.text}")
    return response.json()

def create_table(token: str, community_id: int, name: str):
    """Create a table in the community"""
    response = requests.post(
        f"{BASE_URL}/api/communities/{community_id}/tables",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": name,
            "seats": 6,
            "small_blind": 5,
            "big_blind": 10,
            "min_buyin": 100,
            "max_buyin": 1000
        }
    )
    if response.status_code not in [200, 201]:
        raise Exception(f"Failed to create table: {response.text}")
    return response.json()

def get_my_hand_history(token: str, limit: int = 20):
    """Get hand history for current user"""
    response = requests.get(
        f"{BASE_URL}/api/me/hands",
        headers={"Authorization": f"Bearer {token}"},
        params={"limit": limit}
    )
    return response

def get_hand_details(token: str, hand_id: str):
    """Get full details of a specific hand"""
    response = requests.get(
        f"{BASE_URL}/api/hands/{hand_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    return response

async def play_hand_via_websocket(token: str, table_id: int, username: str):
    """Connect via WebSocket and play actions"""
    uri = f"{WS_URL}?token={token}"
    
    try:
        async with websockets.connect(uri) as websocket:
            print(f"  [{username}] Connected to game server")
            
            # Join table
            await websocket.send(json.dumps({
                "type": "JOIN_TABLE",
                "tableId": table_id,
                "buyIn": 500
            }))
            
            # Listen for messages
            messages_received = 0
            game_complete = False
            
            while messages_received < 30 and not game_complete:  # Limit iterations
                try:
                    message = await asyncio.wait_for(websocket.recv(), timeout=2.0)
                    data = json.loads(message)
                    messages_received += 1
                    
                    # Check for game complete
                    if data.get("type") == "GAME_STATE":
                        stage = data.get("game", {}).get("stage")
                        if stage == "complete":
                            print(f"  [{username}] Game complete!")
                            game_complete = True
                            break
                    
                    # Handle action required
                    if data.get("type") == "ACTION_REQUIRED":
                        player_id = data.get("playerId")
                        print(f"  [{username}] Action required for player {player_id}")
                        
                        # Simple strategy: call if possible, otherwise check/fold
                        await websocket.send(json.dumps({
                            "type": "PLAYER_ACTION",
                            "action": "call"
                        }))
                        
                except asyncio.TimeoutError:
                    if game_complete:
                        break
                    continue
                    
            print(f"  [{username}] Disconnected (received {messages_received} messages)")
            
    except Exception as e:
        print(f"  [{username}] WebSocket error: {e}")

async def main():
    print("=" * 80)
    print("COMPLETE HAND HISTORY TEST")
    print("=" * 80)
    print()
    
    timestamp = int(time.time())
    
    # Create two test users
    print("👥 Creating test users...")
    users = []
    for i in range(1, 3):
        username = f"handtest_{timestamp}_p{i}"
        password = "password123"
        create_user(username, password)
        token = login(username, password)
        users.append({"username": username, "password": password, "token": token})
        print(f"  ✅ Created {username}")
    
    print()
    
    # Create community and table
    print("🏠 Creating league, community, and table...")
    league = create_league(users[0]["token"], f"HandTestLeague_{timestamp}")
    print(f"  ✅ Created league: {league['name']}")
    
    community = create_community(users[0]["token"], league["id"], f"HandTestCommunity_{timestamp}")
    print(f"  ✅ Created community: {community['name']}")
    
    table = create_table(users[0]["token"], community["id"], f"HandTestTable_{timestamp}")
    print(f"  ✅ Created table: {table['name']} (ID: {table['id']})")
    print()
    
    # Play a hand
    print("🎮 Playing a hand...")
    print()
    
    # Both players join and play
    tasks = [
        play_hand_via_websocket(users[i]["token"], table["id"], users[i]["username"])
        for i in range(2)
    ]
    await asyncio.gather(*tasks)
    
    print()
    print("⏳ Waiting for hand history to be recorded...")
    await asyncio.sleep(2)  # Give server time to record
    
    print()
    
    # Check hand history for both players
    for user in users:
        print(f"📜 Checking hand history for {user['username']}...")
        resp = get_my_hand_history(user["token"], limit=10)
        
        if resp.status_code == 200:
            hands = resp.json()
            print(f"  ✅ Found {len(hands)} hands in history")
            
            if len(hands) > 0:
                hand = hands[0]
                print(f"  📋 Latest hand:")
                print(f"     Table: {hand['table_name']}")
                print(f"     Played at: {hand['played_at']}")
                print(f"     Players: {hand['player_count']}")
                print(f"     Pot: {hand['pot_size']} chips")
                if hand.get('winner_username'):
                    print(f"     Winner: {hand['winner_username']}")
                
                # Get full details
                detail_resp = get_hand_details(user["token"], hand["id"])
                if detail_resp.status_code == 200:
                    details = detail_resp.json()
                    hand_data = details["hand_data"]
                    print(f"     Community Cards: {hand_data.get('community_cards', [])}")
                    print(f"     Players in hand:")
                    for player in hand_data.get("players", []):
                        print(f"       - {player.get('username')} (Seat {player.get('seat_number')}): {player.get('final_stack')} chips")
            else:
                print(f"  ⚠️  No hands found (hand may not have completed)")
        else:
            print(f"  ❌ Failed to get hand history: {resp.status_code}")
            print(f"     {resp.text}")
        
        print()
    
    print("=" * 80)
    print("TEST COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    asyncio.run(main())
