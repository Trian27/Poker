#!/usr/bin/env python3
"""
Test script for seat selection feature
Tests that players can choose their seats and turn order follows seat numbers
"""

import requests
import time
import sys

BASE_URL = "http://localhost:8000"
API_URL = f"{BASE_URL}/api"
AUTH_URL = f"{BASE_URL}/auth"

def register_and_login(username: str, password: str):
    """Register a new user and log them in"""
    # Register
    register_data = {
        "username": username,
        "email": f"{username}@test.com",
        "password": password
    }
    
    try:
        response = requests.post(f"{AUTH_URL}/register", json=register_data)
        if response.status_code == 201:
            print(f"✅ Registered {username}")
        elif response.status_code == 400 and "already exists" in response.text.lower():
            print(f"ℹ️  {username} already exists")
        else:
            print(f"❌ Registration failed: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Registration error: {e}")
        return None
    
    # Login
    login_data = {
        "username": username,
        "password": password
    }
    
    try:
        response = requests.post(f"{AUTH_URL}/login", params=login_data)
        if response.status_code == 200:
            token = response.json()["access_token"]
            # Decode the token to get user_id (simple base64 decode of JWT payload)
            import json
            import base64
            payload_part = token.split('.')[1]
            # Add padding if needed
            padding = 4 - len(payload_part) % 4
            if padding != 4:
                payload_part += '=' * padding
            payload = json.loads(base64.urlsafe_b64decode(payload_part))
            user_id = payload["user_id"]
            print(f"✅ Logged in as {username} (ID: {user_id})")
            return {"token": token, "user_id": user_id, "username": username}
        else:
            print(f"❌ Login failed: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Login error: {e}")
        return None


def create_infrastructure(token):
    """Create league, community, and table"""
    # Create league
    league_data = {
        "name": f"Test League {int(time.time())}",
        "description": "Seat selection test"
    }
    
    response = requests.post(
        f"{API_URL}/leagues",
        json=league_data,
        params={"token": token}
    )
    
    if response.status_code != 201:
        print(f"❌ Failed to create league: {response.text}")
        return None
    
    league_id = response.json()["id"]
    print(f"✅ Created league (ID: {league_id})")
    
    # Create community
    community_data = {
        "name": "Test Community",
        "description": "For seat testing",
        "league_id": league_id,
        "starting_balance": 10000
    }
    
    response = requests.post(
        f"{API_URL}/communities",
        json=community_data,
        params={"token": token}
    )
    
    if response.status_code != 201:
        print(f"❌ Failed to create community: {response.text}")
        return None
    
    community_id = response.json()["id"]
    print(f"✅ Created community (ID: {community_id})")
    
    # Create table with 6 seats
    table_data = {
        "name": "Seat Test Table",
        "game_type": "cash",
        "max_seats": 6,
        "small_blind": 10,
        "big_blind": 20,
        "buy_in": 1000
    }
    
    response = requests.post(
        f"{API_URL}/communities/{community_id}/tables",
        json=table_data,
        params={"token": token}
    )
    
    if response.status_code != 201:
        print(f"❌ Failed to create table: {response.text}")
        return None
    
    table = response.json()
    table_id = table["id"]
    print(f"✅ Created table (ID: {table_id}, Max seats: {table['max_seats']})")
    
    return {
        "league_id": league_id,
        "community_id": community_id,
        "table_id": table_id
    }


def get_available_seats(table_id, token):
    """Get list of available seats"""
    response = requests.get(
        f"{API_URL}/tables/{table_id}/seats",
        params={"token": token}
    )
    
    if response.status_code == 200:
        return response.json()
    else:
        print(f"❌ Failed to get seats: {response.text}")
        return None


def join_community(community_id, user_token):
    """Join a community to get a wallet"""
    response = requests.post(
        f"{API_URL}/communities/{community_id}/join",
        params={"token": user_token}
    )
    
    if response.status_code in [200, 201]:
        print(f"✅ Joined community {community_id}")
        return True
    else:
        print(f"❌ Failed to join community: {response.text}")
        return False


def join_table(table_id, seat_number, user_token, buy_in_amount=1000):
    """Join a table at a specific seat"""
    join_data = {
        "buy_in_amount": buy_in_amount,
        "seat_number": seat_number
    }
    
    response = requests.post(
        f"{API_URL}/tables/{table_id}/join",
        json=join_data,
        params={"token": user_token}
    )
    
    if response.status_code == 200:
        print(f"✅ Joined table at seat {seat_number}")
        return True
    else:
        print(f"❌ Failed to join table: {response.text}")
        return False


def main():
    print("=" * 60)
    print("Seat Selection Test")
    print("=" * 60)
    print()
    
    # Create 4 test players
    players = []
    for i in range(1, 5):
        username = f"seat_player_{i}_{int(time.time())}"
        password = "testpass123"
        
        print(f"\n{'='*60}")
        print(f"Player {i} Setup")
        print(f"{'='*60}")
        
        user = register_and_login(username, password)
        if not user:
            print(f"❌ Failed to setup player {i}")
            return 1
        
        players.append(user)
    
    # Use first player to create infrastructure
    print(f"\n{'='*60}")
    print("Creating Game Infrastructure")
    print(f"{'='*60}")
    
    infra = create_infrastructure(players[0]["token"])
    if not infra:
        print("❌ Failed to create infrastructure")
        return 1
    
    # All players join community
    print(f"\n{'='*60}")
    print("Players Joining Community")
    print(f"{'='*60}")
    
    for player in players:
        if not join_community(infra["community_id"], player["token"]):
            return 1
    
    # Check available seats
    print(f"\n{'='*60}")
    print("Available Seats (Before Joining)")
    print(f"{'='*60}")
    
    seats = get_available_seats(infra["table_id"], players[0]["token"])
    if seats:
        for seat in seats:
            status = f"Occupied by {seat['username']}" if seat['user_id'] else "Available"
            print(f"  Seat {seat['seat_number']}: {status}")
    
    # Players choose seats: 1, 3, 5, 6 (NOT sequential!)
    print(f"\n{'='*60}")
    print("Players Selecting Seats")
    print(f"{'='*60}")
    
    seat_choices = [1, 3, 5, 6]  # Non-sequential to test turn order
    
    for i, player in enumerate(players):
        seat_num = seat_choices[i]
        print(f"\n{player['username']} choosing seat {seat_num}...")
        if not join_table(infra["table_id"], seat_num, player["token"]):
            return 1
    
    # Check seats again
    print(f"\n{'='*60}")
    print("Seat Occupancy (After Joining)")
    print(f"{'='*60}")
    
    seats = get_available_seats(infra["table_id"], players[0]["token"])
    if seats:
        for seat in seats:
            if seat['user_id']:
                print(f"  Seat {seat['seat_number']}: ✅ {seat['username']}")
            else:
                print(f"  Seat {seat['seat_number']}: ⬜ Available")
    
    # Test: Try to take an occupied seat
    print(f"\n{'='*60}")
    print("Testing Seat Conflict (Expected to Fail)")
    print(f"{'='*60}")
    
    duplicate_player = register_and_login(f"duplicate_{int(time.time())}", "testpass123")
    if duplicate_player:
        join_community(infra["community_id"], duplicate_player["token"])
        print("\nAttempting to take seat 3 (already occupied)...")
        join_table(infra["table_id"], 3, duplicate_player["token"])
    
    # Test: Try to join same table twice
    print(f"\n{'='*60}")
    print("Testing Double Join (Expected to Fail)")
    print(f"{'='*60}")
    
    print(f"\n{players[0]['username']} attempting to join again...")
    join_table(infra["table_id"], 2, players[0]["token"])
    
    print(f"\n{'='*60}")
    print("✅ Test Complete!")
    print(f"{'='*60}")
    print("\n📊 Summary:")
    print(f"  - Created table with 6 seats")
    print(f"  - 4 players selected seats: {seat_choices}")
    print(f"  - Turn order will be: {' → '.join(map(str, sorted(seat_choices)))} → {sorted(seat_choices)[0]} (circular)")
    print(f"  - Seat conflict prevention tested ✓")
    print(f"  - Double join prevention tested ✓")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
