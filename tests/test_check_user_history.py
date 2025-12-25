"""
Check hand history for a specific user
"""
import requests
import sys

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

def get_my_hand_history(token: str):
    """Get hand history for current user"""
    response = requests.get(
        f"{BASE_URL}/api/me/hands",
        headers={"Authorization": f"Bearer {token}"},
        params={"limit": 20}
    )
    return response

def get_hand_details(token: str, hand_id: str):
    """Get full details of a specific hand"""
    response = requests.get(
        f"{BASE_URL}/api/hands/{hand_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    return response

if len(sys.argv) < 2:
    print("Usage: python check_user_history.py <username>")
    print("Example: python check_user_history.py bot_player_1_1761441092")
    sys.exit(1)

username = sys.argv[1]
password = "testpass123"

print("=" * 80)
print(f"CHECKING HAND HISTORY FOR: {username}")
print("=" * 80)
print()

try:
    print(f"🔑 Logging in as {username}...")
    token = login(username, password)
    print("✅ Logged in successfully")
    print()
    
    print("📜 Fetching hand history...")
    resp = get_my_hand_history(token)
    
    if resp.status_code == 200:
        hands = resp.json()
        print(f"✅ Found {len(hands)} hands in history")
        print()
        
        if len(hands) > 0:
            print("Recent hands:")
            print("-" * 80)
            for i, hand in enumerate(hands, 1):
                print(f"{i}. {hand['table_name']}")
                print(f"   Played at: {hand['played_at']}")
                print(f"   Players: {hand['player_count']}")
                print(f"   Pot: {hand['pot_size']} chips")
                if hand.get('winner_username'):
                    print(f"   Winner: {hand['winner_username']}")
                print()
            
            # Get details of the first hand
            first_hand = hands[0]
            print(f"🔍 Fetching full details for hand...")
            detail_resp = get_hand_details(token, first_hand['id'])
            
            if detail_resp.status_code == 200:
                details = detail_resp.json()
                print("=" * 80)
                print("FULL HAND DATA")
                print("=" * 80)
                print(f"Hand ID: {details['id']}")
                print(f"Table: {details['table_name']}")
                print(f"Played at: {details['played_at']}")
                print()
                
                hand_data = details['hand_data']
                print(f"Pot: {hand_data.get('pot', 0)} chips")
                print(f"Community Cards: {hand_data.get('community_cards', [])}")
                print()
                
                print("Players:")
                for player in hand_data.get('players', []):
                    print(f"  - {player.get('username')} (Seat {player.get('seat_number')})")
                    print(f"    Cards: {player.get('cards', [])}")
                    print(f"    Initial stack: {player.get('initial_stack')} chips")
                    print(f"    Final stack: {player.get('final_stack')} chips")
                    if player.get('folded'):
                        print(f"    Status: Folded")
                    elif player.get('all_in'):
                        print(f"    Status: All-in")
                    print()
                
                winner = hand_data.get('winner')
                if winner:
                    print(f"🏆 Winner: {winner.get('username')}")
                    print(f"   Won: {winner.get('amount', 0)} chips")
                
            else:
                print(f"❌ Failed to get hand details: {detail_resp.status_code}")
                print(f"   {detail_resp.text}")
        else:
            print("⚠️  No hands found in history")
            print("   The game may not have completed yet, or hand recording failed")
    else:
        print(f"❌ Failed to get hand history: {resp.status_code}")
        print(f"   {resp.text}")

except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)

print()
print("=" * 80)
