#!/usr/bin/env python3
"""
Test script for WebSocket Agent (Chunk 6)
Tests the complete flow: Register bot → Login → Create/Join game → Bot plays

Usage:
    workon poker
    python scripts/manual_checks/websocket_agent_check.py
"""

import requests
import time
import sys

# Configuration
AUTH_API_URL = 'http://localhost:8000'
GAME_SERVER_URL = 'http://localhost:3000'

def test_websocket_agent():
    """Test the WebSocket agent functionality"""
    
    print("="*70)
    print("🧪 Testing WebSocket Agent (Chunk 6)")
    print("="*70)
    print()
    
    # Generate unique username
    bot_username = f"testbot_{int(time.time())}"
    bot_password = "testpass123"
    bot_email = f"{bot_username}@example.com"
    
    print(f"🤖 Creating test bot account: {bot_username}")
    
    # Step 1: Register the bot
    try:
        response = requests.post(
            f"{AUTH_API_URL}/auth/register",
            json={
                'username': bot_username,
                'email': bot_email,
                'password': bot_password
            }
        )
        
        if response.status_code in [200, 201]:
            bot_data = response.json()
            print(f"✅ Bot registered! User ID: {bot_data['id']}")
        else:
            print(f"❌ Registration failed: {response.status_code}")
            print(response.text)
            return False
            
    except Exception as e:
        print(f"❌ Registration error: {e}")
        return False
    
    # Step 2: Login to get JWT
    try:
        print(f"\n🔐 Logging in as {bot_username}...")
        response = requests.post(
            f"{AUTH_API_URL}/auth/login",
            params={
                'username': bot_username,
                'password': bot_password
            }
        )
        
        if response.status_code == 200:
            login_data = response.json()
            jwt_token = login_data['access_token']
            print(f"✅ Login successful! JWT token obtained")
        else:
            print(f"❌ Login failed: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Login error: {e}")
        return False
    
    # Step 3: Create a league
    try:
        print(f"\n🏆 Creating test league...")
        response = requests.post(
            f"{AUTH_API_URL}/api/leagues",
            json={'name': f'Test League {int(time.time())}'},
            params={'token': jwt_token}
        )
        
        if response.status_code in [200, 201]:
            league_data = response.json()
            league_id = league_data['id']
            print(f"✅ League created! ID: {league_id}")
        else:
            print(f"❌ League creation failed: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ League creation error: {e}")
        return False
    
    # Step 4: Create a community
    try:
        print(f"\n🏘️  Creating test community...")
        response = requests.post(
            f"{AUTH_API_URL}/api/communities",
            json={
                'name': f'Test Community {int(time.time())}',
                'description': 'Test community for WebSocket agent',
                'league_id': league_id
            },
            params={'token': jwt_token}
        )
        
        if response.status_code in [200, 201]:
            community_data = response.json()
            community_id = community_data['id']
            print(f"✅ Community created! ID: {community_id}")
        else:
            print(f"❌ Community creation failed: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Community creation error: {e}")
        return False
    
    # Step 5: Join the community (creates wallet)
    try:
        print(f"\n💰 Joining community (creates wallet)...")
        response = requests.post(
            f"{AUTH_API_URL}/api/communities/{community_id}/join",
            params={'token': jwt_token}
        )
        
        if response.status_code == 200:
            print(f"✅ Joined community! Wallet created with 10,000 chips")
        else:
            print(f"❌ Join failed: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Join error: {e}")
        return False
    
    # Step 6: Create a table
    try:
        print(f"\n🎰 Creating poker table...")
        response = requests.post(
            f"{AUTH_API_URL}/api/communities/{community_id}/tables",
            json={
                'name': 'WebSocket Agent Test Table',
                'game_type': 'cash',
                'max_seats': 6,
                'small_blind': 10,
                'big_blind': 20,
                'buy_in': 1000
            },
            params={'token': jwt_token}
        )
        
        if response.status_code in [200, 201]:
            table_data = response.json()
            table_id = table_data['id']
            print(f"✅ Table created! ID: {table_id}")
        else:
            print(f"❌ Table creation failed: {response.status_code}")
            print(response.text)
            return False
            
    except Exception as e:
        print(f"❌ Table creation error: {e}")
        return False
    
    # Step 7: Join the table
    try:
        print(f"\n💺 Joining table with 1000 chip buy-in...")
        response = requests.post(
            f"{AUTH_API_URL}/api/tables/{table_id}/join",
            json={'buy_in_amount': 1000},
            params={'token': jwt_token}
        )
        
        if response.status_code == 200:
            join_data = response.json()
            game_id = join_data['game_id']
            print(f"✅ Joined table! Game ID: {game_id}")
            print(f"💰 New wallet balance: {join_data['new_balance']}")
        else:
            print(f"❌ Join table failed: {response.status_code}")
            print(response.text)
            return False
            
    except Exception as e:
        print(f"❌ Join table error: {e}")
        return False
    
    # Success! Print instructions
    print("\n" + "="*70)
    print("✅ Setup Complete! Ready to test WebSocket agent")
    print("="*70)
    print()
    print("📋 Test Details:")
    print(f"   Bot Username: {bot_username}")
    print(f"   Bot Password: {bot_password}")
    print(f"   Game ID: {game_id}")
    print()
    print("🚀 Run the WebSocket agent with:")
    print()
    print(f"   workon poker")
    print(f"   python poker-agent-api/agent_websocket.py \\")
    print(f"       --username {bot_username} \\")
    print(f"       --password {bot_password} \\")
    print(f"       --game-id {game_id}")
    print()
    print("💡 The bot will connect via WebSocket and start playing automatically!")
    print()
    print("📊 To add more players (human or bot), create additional accounts")
    print("   and join the same game ID.")
    print()
    
    return True


if __name__ == '__main__':
    try:
        success = test_websocket_agent()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n👋 Test interrupted")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
