"""
Test script to verify that players can only join when they would be the big blind.
This prevents players from joining to skip blinds and leaving before paying them.

Scenario:
1. Create a table with 9 seats
2. Player 1 joins seat 1, Player 2 joins seat 3
3. Start the game (dealer at seat 1, SB at seat 3, BB would be at next seat if existed)
4. Try to have Player 3 join at various seats
5. Only the seat that would be BB next hand should be allowed
"""

import requests
import time

BASE_URL = "http://localhost:8000"
GAME_SERVER_URL = "http://localhost:3000"

def create_user(username: str, password: str):
    """Create a new user account"""
    response = requests.post(f"{BASE_URL}/auth/register", json={
        "username": username,
        "email": f"{username}@test.com",
        "password": password
    })
    if response.status_code in [200, 201]:
        print(f"✅ Created user: {username}")
    elif response.status_code == 400:
        print(f"ℹ️  User {username} already exists")
    else:
        print(f"⚠️  Error creating user: {response.status_code}")
    return response

def login(username: str, password: str):
    """Login and get token"""
    response = requests.post(f"{BASE_URL}/auth/login", params={
        "username": username,
        "password": password
    })
    if response.status_code != 200:
        print(f"❌ Login failed for {username}: {response.status_code}")
        print(f"   Response: {response.text}")
        raise Exception(f"Login failed: {response.text}")
    return response.json()["access_token"]

def create_community(token: str, name: str):
    """Create a community"""
    response = requests.post(
        f"{BASE_URL}/api/communities",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": name, "description": "Test community"}
    )
    if response.status_code not in [200, 201]:
        print(f"❌ Community creation failed: {response.status_code}")
        print(f"   Response: {response.text}")
        raise Exception(f"Community creation failed: {response.text}")
    return response.json()["id"]

def create_table(token: str, community_id: int, max_seats: int = 9):
    """Create a table with specific max seats"""
    response = requests.post(
        f"{BASE_URL}/api/tables",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Blind Test Table",
            "game_type": "cash_game",
            "small_blind": 10,
            "big_blind": 20,
            "min_buy_in": 1000,
            "max_buy_in": 10000,
            "max_seats": max_seats,
            "community_id": community_id
        }
    )
    return response.json()["id"]

def join_table(token: str, table_id: int, seat_number: int, buy_in: int = 2000):
    """Join a table at specific seat"""
    response = requests.post(
        f"{BASE_URL}/api/tables/{table_id}/join",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "buy_in_amount": buy_in,
            "seat_number": seat_number
        }
    )
    return response

def get_game_state(table_id: int):
    """Get current game state from game server"""
    try:
        response = requests.get(f"{GAME_SERVER_URL}/_internal/game-state/table_{table_id}")
        if response.status_code == 200:
            return response.json()
        return None
    except:
        return None

def start_game(table_id: int):
    """Manually trigger game start"""
    response = requests.post(f"{GAME_SERVER_URL}/_internal/start-game/table_{table_id}")
    return response.status_code == 200

def main():
    print("=" * 80)
    print("BLIND JOIN PREVENTION TEST")
    print("=" * 80)
    print()

    # Create users
    print("📝 STEP 1: Creating test users...")
    create_user("blind_test_p1", "password123")
    create_user("blind_test_p2", "password123")
    create_user("blind_test_p3", "password123")
    
    token1 = login("blind_test_p1", "password123")
    token2 = login("blind_test_p2", "password123")
    token3 = login("blind_test_p3", "password123")
    print()

    # Create community
    print("🏘️  STEP 2: Creating community...")
    community_id = create_community(token1, "Blind Test Community")
    print(f"✅ Community created: {community_id}")
    print()

    # Create table with 9 seats
    print("🎲 STEP 3: Creating table with 9 seats...")
    table_id = create_table(token1, community_id, max_seats=9)
    print(f"✅ Table created: {table_id}")
    print()

    # Player 1 joins seat 1
    print("💺 STEP 4: Player 1 joins seat 1...")
    resp = join_table(token1, table_id, seat_number=1, buy_in=2000)
    if resp.status_code == 200:
        print("✅ Player 1 seated at seat 1")
    else:
        print(f"❌ Failed: {resp.json()}")
    print()

    # Player 2 joins seat 3
    print("💺 STEP 5: Player 2 joins seat 3...")
    resp = join_table(token2, table_id, seat_number=3, buy_in=2000)
    if resp.status_code == 200:
        print("✅ Player 2 seated at seat 3")
    else:
        print(f"❌ Failed: {resp.json()}")
    print()

    # Wait for game to start
    print("⏳ Waiting for game to start...")
    time.sleep(3)
    
    game_state = get_game_state(table_id)
    if game_state:
        print(f"🎮 Game State: {game_state['stage']}")
        print(f"   Dealer Index: {game_state['dealerIndex']}")
        print(f"   Small Blind Index: {game_state['smallBlindIndex']}")
        print(f"   Big Blind Index: {game_state['bigBlindIndex']}")
        print(f"   Players: {len(game_state['players'])}")
        for i, p in enumerate(game_state['players']):
            print(f"     [{i}] Seat {p.get('seatNumber', '?')}: {p['name']}")
    print()

    # Now try to join at different seats
    print("=" * 80)
    print("TESTING BLIND JOIN PREVENTION")
    print("=" * 80)
    print()
    print("Current situation:")
    print("  - Seats occupied: 1, 3")
    print("  - Dealer will move to next position after this hand")
    print("  - We need to calculate which seat would be BB next hand")
    print()

    # Calculate expected next BB position
    # With 2 players at seats 1 and 3:
    # - Current dealer at index 0 (seat 1)
    # - Next dealer at index 1 (seat 3)
    # - For heads-up: BB is opponent of dealer
    # - So if dealer is at seat 3, BB would be at seat 1
    # - But if a 3rd player joins, it's no longer heads-up
    # - Need to figure out the logic...
    
    print("🧪 TEST 1: Try joining seat 2 (between 1 and 3)...")
    resp = join_table(token3, table_id, seat_number=2, buy_in=2000)
    if resp.status_code == 200:
        print("✅ Allowed to join seat 2")
    else:
        print(f"❌ Blocked from seat 2: {resp.json().get('detail', 'Unknown error')}")
    print()

    # If that didn't work, try other seats
    for seat in [4, 5, 6, 7, 8, 9]:
        print(f"🧪 TEST: Try joining seat {seat}...")
        resp = join_table(token3, table_id, seat_number=seat, buy_in=2000)
        if resp.status_code == 200:
            print(f"✅ Allowed to join seat {seat}")
            print("   This should be the big blind position for next hand!")
            break
        else:
            error_msg = resp.json().get('detail', 'Unknown error')
            print(f"❌ Blocked from seat {seat}")
            if "big blind" in error_msg.lower():
                print(f"   Reason: {error_msg}")
        print()

    print()
    print("=" * 80)
    print("TEST COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    main()
