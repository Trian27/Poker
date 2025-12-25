"""
Test script for Hand History feature

This tests:
1. Playing a full hand and verifying history is recorded
2. Retrieving hand history via API
3. Viewing specific hand details
"""

import requests
import time

BASE_URL = "http://localhost:8000"

def login(username: str, password: str):
    """Login and get token"""
    response = requests.post(f"{BASE_URL}/auth/login", params={
        "username": username,
        "password": password
    })
    if response.status_code != 200:
        raise Exception(f"Login failed: {response.text}")
    return response.json()["access_token"]

def create_user(username: str, password: str):
    """Create a new user account"""
    response = requests.post(f"{BASE_URL}/auth/register", json={
        "username": username,
        "email": f"{username}@test.com",
        "password": password
    })
    return response.status_code in [200, 201]

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

def main():
    print("=" * 80)
    print("HAND HISTORY TEST")
    print("=" * 80)
    print()

    # Use existing test users
    username = "seat_player_1_1761437682"
    password = "password123"
    
    print(f"🔑 Logging in as {username}...")
    try:
        token = login(username, password)
        print("✅ Logged in successfully")
    except Exception as e:
        print(f"❌ Login failed: {e}")
        print("\nTrying to create a test user instead...")
        username = f"history_test_{int(time.time())}"
        password = "password123"
        create_user(username, password)
        token = login(username, password)
        print(f"✅ Created and logged in as {username}")
    
    print()
    print("📜 Fetching hand history...")
    resp = get_my_hand_history(token, limit=10)
    
    if resp.status_code == 200:
        hands = resp.json()
        print(f"✅ Found {len(hands)} hands in history")
        print()
        
        if len(hands) > 0:
            print("Recent hands:")
            print("-" * 80)
            for i, hand in enumerate(hands[:5], 1):
                print(f"{i}. {hand['table_name']}")
                print(f"   Played at: {hand['played_at']}")
                print(f"   Players: {hand['player_count']}")
                print(f"   Pot: {hand['pot_size']} chips")
                if hand.get('winner_username'):
                    print(f"   Winner: {hand['winner_username']}")
                print()
            
            # Get details of the first hand
            first_hand_id = hands[0]['id']
            print(f"🔍 Fetching details for hand {first_hand_id}...")
            detail_resp = get_hand_details(token, first_hand_id)
            
            if detail_resp.status_code == 200:
                details = detail_resp.json()
                print("✅ Hand details retrieved")
                print()
                print("Full Hand Data:")
                print("-" * 80)
                print(f"Table: {details['table_name']}")
                print(f"Community: {details['community_id']}")
                print(f"Played at: {details['played_at']}")
                print()
                
                hand_data = details['hand_data']
                print(f"Pot: {hand_data.get('pot', 0)} chips")
                print(f"Community Cards: {hand_data.get('community_cards', [])}")
                print()
                
                print("Players:")
                for player in hand_data.get('players', []):
                    print(f"  - {player.get('username')} (Seat {player.get('seat_number')})")
                    print(f"    Final stack: {player.get('final_stack')} chips")
                    if player.get('folded'):
                        print(f"    Status: Folded")
                    elif player.get('all_in'):
                        print(f"    Status: All-in")
                    print()
                
                winner = hand_data.get('winner')
                if winner:
                    print(f"Winner: {winner.get('username')}")
                
            else:
                print(f"❌ Failed to get hand details: {detail_resp.status_code}")
                print(f"   {detail_resp.text}")
        else:
            print("No hands found in history yet.")
            print("Play some hands first to see history!")
    else:
        print(f"❌ Failed to get hand history: {resp.status_code}")
        print(f"   {resp.text}")
    
    print()
    print("=" * 80)
    print("TEST COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    main()
