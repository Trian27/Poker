#!/usr/bin/env python3
"""
Test table queue functionality
"""
import requests
import time

BASE_URL = "http://localhost:8000"

def test_table_queue():
    """Test table queue join, leave, and get operations"""
    
    print("\n=== Testing Table Queue System ===\n")
    
    # 1. Create test users
    print("1. Creating test users...")
    users = []
    for i in range(4):
        username = f"queueuser{i}_{int(time.time())}"
        password = "password123"
        
        # Register
        response = requests.post(
            f"{BASE_URL}/auth/register",
            json={
                "username": username,
                "email": f"{username}@test.com",
                "password": password
            }
        )
        assert response.status_code == 201, f"Failed to create user {i}: {response.text}"
        user_data = response.json()
        
        # Login to get token
        response = requests.post(
            f"{BASE_URL}/auth/login",
            params={"username": username, "password": password}
        )
        assert response.status_code == 200, f"Failed to login user {i}: {response.text}"
        token_data = response.json()
        
        users.append({
            "id": user_data["id"],
            "username": user_data["username"],
            "token": token_data["access_token"]
        })
        print(f"   ✓ Created user: {user_data['username']}")
    
    # 2. Create a league (owner = user 0)
    print("\n2. Creating league...")
    headers = {"Authorization": f"Bearer {users[0]['token']}"}
    response = requests.post(
        f"{BASE_URL}/api/leagues",
        json={"name": f"Queue Test League {int(time.time())}"},
        headers=headers
    )
    if response.status_code not in [200, 201]:
        raise Exception(f"Failed to create league: {response.text}")
    league_id = response.json()["id"]
    print(f"   ✓ Created league with ID: {league_id}")
    
    # 3. Create a community
    print("\n3. Creating community...")
    response = requests.post(
        f"{BASE_URL}/api/communities",
        json={
            "name": f"Queue Test Community {int(time.time())}",
            "league_id": league_id,
            "starting_balance": 1000
        },
        headers=headers
    )
    if response.status_code not in [200, 201]:
        raise Exception(f"Failed to create community: {response.text}")
    community_id = response.json()["id"]
    print(f"   ✓ Created community with ID: {community_id}")
    
    # 4. All users join the community (this creates wallets automatically)
    print("\n4. All users joining community (creates wallets)...")
    for user in users:
        headers = {"Authorization": f"Bearer {user['token']}"}
        response = requests.post(
            f"{BASE_URL}/api/communities/{community_id}/join",
            headers=headers
        )
        if response.status_code not in [200, 201]:
            raise Exception(f"Failed to join community: {response.text}")
        print(f"   ✓ User {user['username']} joined community and got wallet")
    
    # 5. Create a small table (2 seats max) with queue enabled
    print("\n5. Creating table with 2 seats and max queue size of 5...")
    headers = {"Authorization": f"Bearer {users[0]['token']}"}
    response = requests.post(
        f"{BASE_URL}/api/communities/{community_id}/tables",
        json={
            "name": f"Queue Test Table {int(time.time())}",
            "max_seats": 2,
            "small_blind": "1.00",
            "big_blind": "2.00",
            "min_buyin": "20.00",
            "max_buyin": "200.00",
            "is_permanent": False,
            "max_queue_size": 5,
            "action_timeout_seconds": 30
        },
        headers=headers
    )
    if response.status_code not in [200, 201]:
        raise Exception(f"Failed to create table: {response.text}")
    table = response.json()
    table_id = table["id"]
    print(f"   ✓ Created table with ID: {table_id}")
    print(f"   ✓ Max seats: {table['max_seats']}")
    if 'max_queue_size' in table:
        print(f"   ✓ Max queue size: {table['max_queue_size']}")
    else:
        print(f"   ⚠ Warning: max_queue_size not in response")
    if 'action_timeout_seconds' in table:
        print(f"   ✓ Action timeout: {table['action_timeout_seconds']}s")
    else:
        print(f"   ⚠ Warning: action_timeout_seconds not in response")
    
    # 6. Get empty queue
    print("\n6. Checking empty queue...")
    headers = {"Authorization": f"Bearer {users[0]['token']}"}
    response = requests.get(
        f"{BASE_URL}/api/tables/{table_id}/queue",
        headers=headers
    )
    assert response.status_code == 200, f"Failed to get queue: {response.text}"
    queue = response.json()
    assert len(queue) == 0, f"Queue should be empty, but has {len(queue)} entries"
    print(f"   ✓ Queue is empty")
    
    # 7. User 2 joins queue (table not full yet, but testing join)
    print("\n7. User 2 joining queue...")
    headers = {"Authorization": f"Bearer {users[2]['token']}"}
    response = requests.post(
        f"{BASE_URL}/api/tables/{table_id}/queue/join",
        headers=headers
    )
    assert response.status_code == 200, f"Failed to join queue: {response.text}"
    queue_entry = response.json()
    print(f"   ✓ User {users[2]['username']} joined queue at position {queue_entry['position']}")
    assert queue_entry['position'] == 1, "First user should be at position 1"
    
    # 8. User 3 joins queue
    print("\n8. User 3 joining queue...")
    headers = {"Authorization": f"Bearer {users[3]['token']}"}
    response = requests.post(
        f"{BASE_URL}/api/tables/{table_id}/queue/join",
        headers=headers
    )
    assert response.status_code == 200, f"Failed to join queue: {response.text}"
    queue_entry = response.json()
    print(f"   ✓ User {users[3]['username']} joined queue at position {queue_entry['position']}")
    assert queue_entry['position'] == 2, "Second user should be at position 2"
    
    # 9. Get queue with 2 people
    print("\n9. Checking queue with 2 people...")
    headers = {"Authorization": f"Bearer {users[0]['token']}"}
    response = requests.get(
        f"{BASE_URL}/api/tables/{table_id}/queue",
        headers=headers
    )
    assert response.status_code == 200, f"Failed to get queue: {response.text}"
    queue = response.json()
    assert len(queue) == 2, f"Queue should have 2 entries, but has {len(queue)}"
    print(f"   ✓ Queue has 2 people:")
    for entry in queue:
        print(f"      Position {entry['position']}: {entry['username']}")
    
    # 10. User 2 tries to join again (should fail - already in queue)
    print("\n10. User 2 trying to join again (should fail)...")
    headers = {"Authorization": f"Bearer {users[2]['token']}"}
    response = requests.post(
        f"{BASE_URL}/api/tables/{table_id}/queue/join",
        headers=headers
    )
    assert response.status_code == 409, f"Should fail with 409, got {response.status_code}"
    print(f"   ✓ Correctly prevented duplicate queue entry")
    
    # 11. User 2 leaves queue
    print("\n11. User 2 leaving queue...")
    headers = {"Authorization": f"Bearer {users[2]['token']}"}
    response = requests.delete(
        f"{BASE_URL}/api/tables/{table_id}/queue/leave",
        headers=headers
    )
    assert response.status_code == 204, f"Failed to leave queue: {response.status_code}"
    print(f"   ✓ User {users[2]['username']} left queue")
    
    # 12. Check that queue reordered
    print("\n12. Checking queue reordered after user 2 left...")
    headers = {"Authorization": f"Bearer {users[0]['token']}"}
    response = requests.get(
        f"{BASE_URL}/api/tables/{table_id}/queue",
        headers=headers
    )
    assert response.status_code == 200, f"Failed to get queue: {response.text}"
    queue = response.json()
    assert len(queue) == 1, f"Queue should have 1 entry, but has {len(queue)}"
    assert queue[0]['username'] == users[3]['username'], "User 3 should now be at position 1"
    assert queue[0]['position'] == 1, "User 3 should be at position 1"
    print(f"   ✓ Queue reordered correctly:")
    print(f"      Position {queue[0]['position']}: {queue[0]['username']}")
    
    # 13. User 3 leaves queue
    print("\n13. User 3 leaving queue...")
    headers = {"Authorization": f"Bearer {users[3]['token']}"}
    response = requests.delete(
        f"{BASE_URL}/api/tables/{table_id}/queue/leave",
        headers=headers
    )
    assert response.status_code == 204, f"Failed to leave queue: {response.status_code}"
    print(f"   ✓ User {users[3]['username']} left queue")
    
    # 14. Verify queue is empty
    print("\n14. Verifying queue is empty...")
    headers = {"Authorization": f"Bearer {users[0]['token']}"}
    response = requests.get(
        f"{BASE_URL}/api/tables/{table_id}/queue",
        headers=headers
    )
    assert response.status_code == 200, f"Failed to get queue: {response.text}"
    queue = response.json()
    assert len(queue) == 0, f"Queue should be empty, but has {len(queue)} entries"
    print(f"   ✓ Queue is empty")
    
    print("\n=== ✅ All Queue Tests Passed! ===\n")

if __name__ == "__main__":
    test_table_queue()
