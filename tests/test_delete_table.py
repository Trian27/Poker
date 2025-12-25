#!/usr/bin/env python3
"""
Test table deletion by community owners

This test verifies:
1. Only community owners can delete tables
2. Tables with seated players cannot be deleted
3. Empty tables can be deleted by owners
"""

import requests
import sys
import time

# Configuration
AUTH_API_URL = "http://localhost:8000"

def test_table_deletion():
    """Test table deletion permissions"""
    
    print("\n" + "="*80)
    print("Table Deletion Test")
    print("="*80)
    
    # Step 1: Create owner account
    print("\n📝 Step 1: Creating owner account...")
    owner_username = f"owner_{int(time.time())}"
    owner_password = "testpass123"
    owner_email = f"{owner_username}@test.com"
    
    register_response = requests.post(
        f"{AUTH_API_URL}/auth/register",
        json={"username": owner_username, "password": owner_password, "email": owner_email}
    )
    
    if register_response.status_code != 201:
        print(f"❌ Failed to register owner: {register_response.text}")
        return False
    
    login_response = requests.post(
        f"{AUTH_API_URL}/auth/login",
        params={"username": owner_username, "password": owner_password}
    )
    
    owner_token = login_response.json()["access_token"]
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    print(f"✅ Owner account created: {owner_username}")
    
    # Step 2: Create league and community
    print("\n🏆 Step 2: Creating league and community...")
    league_response = requests.post(
        f"{AUTH_API_URL}/api/leagues",
        headers=owner_headers,
        json={
            "name": f"Test League {int(time.time())}",
            "description": "Delete table test"
        }
    )
    league_id = league_response.json()["id"]
    
    community_response = requests.post(
        f"{AUTH_API_URL}/api/communities",
        headers=owner_headers,
        json={
            "name": f"Test Community {int(time.time())}",
            "description": "Delete table test",
            "league_id": league_id,
            "starting_balance": 10000
        }
    )
    community_id = community_response.json()["id"]
    print(f"✅ League {league_id} and Community {community_id} created")
    
    # Step 3: Create a permanent table
    print("\n🎲 Step 3: Creating permanent table...")
    table_response = requests.post(
        f"{AUTH_API_URL}/api/communities/{community_id}/tables",
        headers=owner_headers,
        json={
            "name": f"Test Table {int(time.time())}",
            "game_type": "cash",
            "max_seats": 6,
            "small_blind": 5,
            "big_blind": 10,
            "buy_in": 500,
            "is_permanent": True
        }
    )
    
    table_id = table_response.json()["id"]
    print(f"✅ Table created (ID: {table_id})")
    
    # Step 4: Create regular user
    print("\n👤 Step 4: Creating regular user...")
    user_username = f"user_{int(time.time())}"
    user_password = "testpass123"
    user_email = f"{user_username}@test.com"
    
    register_response = requests.post(
        f"{AUTH_API_URL}/auth/register",
        json={"username": user_username, "password": user_password, "email": user_email}
    )
    
    login_response = requests.post(
        f"{AUTH_API_URL}/auth/login",
        params={"username": user_username, "password": user_password}
    )
    
    user_token = login_response.json()["access_token"]
    user_headers = {"Authorization": f"Bearer {user_token}"}
    print(f"✅ Regular user created: {user_username}")
    
    # Join community
    requests.post(
        f"{AUTH_API_URL}/api/communities/{community_id}/join",
        headers=user_headers
    )
    
    # Step 5: Try to delete as non-owner (should fail)
    print("\n🚫 Step 5: Trying to delete table as non-owner...")
    delete_response = requests.delete(
        f"{AUTH_API_URL}/api/tables/{table_id}",
        headers=user_headers
    )
    
    if delete_response.status_code == 403:
        print("✅ Correctly forbidden: Only owners can delete tables")
    else:
        print(f"❌ Expected 403 Forbidden, got {delete_response.status_code}")
        return False
    
    # Step 6: Verify table still exists
    print("\n📋 Step 6: Verifying table still exists...")
    tables_response = requests.get(
        f"{AUTH_API_URL}/api/communities/{community_id}/tables",
        params={"token": owner_token}
    )
    tables = tables_response.json()
    if any(t["id"] == table_id for t in tables):
        print(f"✅ Table {table_id} still exists")
    else:
        print(f"❌ Table {table_id} was unexpectedly deleted")
        return False
    
    # Step 6b: Owner joins community (needed for joining table)
    print("\n👤 Step 6b: Owner joining community...")
    requests.post(
        f"{AUTH_API_URL}/api/communities/{community_id}/join",
        headers=owner_headers
    )
    print("✅ Owner joined community")
    
    # Step 7: Owner joins the table
    print("\n💺 Step 7: Owner joining table...")
    join_response = requests.post(
        f"{AUTH_API_URL}/api/tables/{table_id}/join",
        headers=owner_headers,
        json={"buy_in_amount": 500, "seat_number": 1}
    )
    
    if join_response.status_code == 200:
        print("✅ Owner seated at table")
    else:
        print(f"❌ Failed to join table: {join_response.text}")
        return False
    
    # Step 8: Try to delete with seated player (should fail)
    print("\n🚫 Step 8: Trying to delete table with seated player...")
    delete_response = requests.delete(
        f"{AUTH_API_URL}/api/tables/{table_id}",
        headers=owner_headers
    )
    
    if delete_response.status_code == 409:
        print("✅ Correctly prevented: Cannot delete table with seated players")
    else:
        print(f"❌ Expected 409 Conflict, got {delete_response.status_code}: {delete_response.text}")
        return False
    
    # Step 9: Create another empty table
    print("\n🎲 Step 9: Creating another table...")
    table2_response = requests.post(
        f"{AUTH_API_URL}/api/communities/{community_id}/tables",
        headers=owner_headers,
        json={
            "name": f"Empty Table {int(time.time())}",
            "game_type": "cash",
            "max_seats": 6,
            "small_blind": 5,
            "big_blind": 10,
            "buy_in": 500,
            "is_permanent": True
        }
    )
    
    table2_id = table2_response.json()["id"]
    print(f"✅ Empty table created (ID: {table2_id})")
    
    # Step 10: Delete empty table as owner (should succeed)
    print("\n✅ Step 10: Deleting empty table as owner...")
    delete_response = requests.delete(
        f"{AUTH_API_URL}/api/tables/{table2_id}",
        headers=owner_headers
    )
    
    if delete_response.status_code == 204:
        print(f"✅ Table {table2_id} successfully deleted")
    else:
        print(f"❌ Expected 204 No Content, got {delete_response.status_code}: {delete_response.text}")
        return False
    
    # Step 11: Verify table is gone
    print("\n📋 Step 11: Verifying table was deleted...")
    tables_response = requests.get(
        f"{AUTH_API_URL}/api/communities/{community_id}/tables",
        params={"token": owner_token}
    )
    tables = tables_response.json()
    if not any(t["id"] == table2_id for t in tables):
        print(f"✅ Table {table2_id} confirmed deleted")
    else:
        print(f"❌ Table {table2_id} still exists")
        return False
    
    # Summary
    print("\n" + "="*80)
    print("Test Results Summary")
    print("="*80)
    print("✅ Only community owners can delete tables (403 for non-owners)")
    print("✅ Cannot delete tables with seated players (409 conflict)")
    print("✅ Owners can delete empty tables (204 success)")
    print("✅ Deleted tables are removed from listing")
    print("\n🎉 All tests passed!")
    
    return True

if __name__ == '__main__':
    try:
        success = test_table_deletion()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n👋 Test interrupted")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
