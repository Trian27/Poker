#!/usr/bin/env python3
"""
Simple Poker Agent Bot

This is a basic bot that connects to the Agent API and plays poker.
It uses a simple strategy: always check/call, never bet or raise.

Usage:
    1. Start all services (auth API, game server, agent API)
    2. Register a user and get a JWT token
    3. Join a game and get the game ID
    4. Run this script with your token and game ID
    
    python agent.py --token YOUR_JWT_TOKEN --game-id GAME_ID --user-id YOUR_USER_ID
"""

import requests
import time
import argparse
import sys

class PokerAgent:
    def __init__(self, token: str, game_id: str, user_id: int, api_base: str = "http://localhost:8001/api/v1"):
        self.token = token
        self.game_id = game_id
        self.user_id = user_id
        self.api_base = api_base
        self.headers = {"Authorization": f"Bearer {token}"}
        self.my_player_id = None
        
    def get_state(self) -> dict:
        """Fetch the current game state"""
        try:
            response = requests.get(
                f"{self.api_base}/game/{self.game_id}/state",
                headers=self.headers,
                timeout=5
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                print(f"❌ Error getting state: {response.status_code} - {response.text}")
                return None
        except Exception as e:
            print(f"❌ Exception getting state: {e}")
            return None
    
    def perform_action(self, action: str, amount: int = None) -> dict:
        """Perform a poker action"""
        try:
            body = {"action": action}
            if amount is not None:
                body["amount"] = amount
            
            print(f"🎯 Performing action: {action}" + (f" {amount}" if amount else ""))
            
            response = requests.post(
                f"{self.api_base}/game/{self.game_id}/action",
                headers=self.headers,
                json=body,
                timeout=30
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                print(f"❌ Error performing action: {response.status_code} - {response.text}")
                return None
        except Exception as e:
            print(f"❌ Exception performing action: {e}")
            return None
    
    def is_my_turn(self, state: dict) -> bool:
        """Check if it's our turn to act"""
        if not state or "gameState" not in state:
            return False
        
        game_state = state["gameState"]
        
        # Get my player ID from the state
        if self.my_player_id is None:
            for player in game_state.get("players", []):
                # Find player by checking if they have our hole cards visibility
                # (In player-specific state, only our cards are revealed)
                if player.get("holeCards") and len(player["holeCards"]) > 0:
                    if player["holeCards"][0].get("suit"):  # Our cards have suit/rank
                        self.my_player_id = player["id"]
                        print(f"🆔 My player ID: {self.my_player_id}")
                        break
        
        # Check if it's my turn
        current_player_index = game_state.get("currentPlayerIndex")
        if current_player_index is not None:
            players = game_state.get("players", [])
            if 0 <= current_player_index < len(players):
                current_player = players[current_player_index]
                return current_player.get("id") == self.my_player_id
        
        return False
    
    def decide_action(self, state: dict) -> tuple:
        """
        Decide what action to take based on game state.
        Returns (action, amount) tuple.
        
        Simple strategy:
        - If no bet, check
        - If there's a bet, call
        - Never bet or raise (too aggressive for a simple bot)
        """
        game_state = state["gameState"]
        current_bet = game_state.get("currentBet", 0)
        
        # Find my player info
        my_player = None
        for player in game_state.get("players", []):
            if player.get("id") == self.my_player_id:
                my_player = player
                break
        
        if not my_player:
            return ("fold", None)
        
        my_stack = my_player.get("stack", 0)
        my_current_bet = my_player.get("currentBet", 0)
        amount_to_call = current_bet - my_current_bet
        
        print(f"💭 Thinking... Current bet: {current_bet}, My bet: {my_current_bet}, Stack: {my_stack}")
        
        # If no bet, check
        if current_bet == 0:
            return ("check", None)
        
        # If there's a bet, call if we can afford it
        if amount_to_call <= my_stack:
            return ("call", None)
        
        # If we can't afford to call, go all-in
        if my_stack > 0:
            return ("all-in", None)
        
        # Last resort: fold
        return ("fold", None)
    
    def run(self, poll_interval: float = 2.0):
        """Main game loop"""
        print(f"🤖 Poker Agent starting...")
        print(f"   Game ID: {self.game_id}")
        print(f"   User ID: {self.user_id}")
        print(f"   Polling every {poll_interval}s")
        print()
        
        consecutive_errors = 0
        max_errors = 5
        
        while True:
            try:
                # Get current state
                state = self.get_state()
                
                if state is None:
                    consecutive_errors += 1
                    if consecutive_errors >= max_errors:
                        print(f"❌ Too many errors ({max_errors}), stopping.")
                        break
                    time.sleep(poll_interval)
                    continue
                
                # Reset error counter on success
                consecutive_errors = 0
                
                # Check if it's our turn
                if self.is_my_turn(state):
                    print("\n" + "="*50)
                    print("🎲 It's my turn!")
                    
                    # Decide action
                    action, amount = self.decide_action(state)
                    
                    # Perform action
                    result = self.perform_action(action, amount)
                    
                    if result:
                        print(f"✅ Action '{action}' completed successfully")
                        
                        # Display updated state
                        if "gameState" in result:
                            game_state = result["gameState"]
                            print(f"   Pot: {game_state.get('pot', 0)}")
                            print(f"   Stage: {game_state.get('stage', 'unknown')}")
                    else:
                        print(f"❌ Failed to perform action '{action}'")
                    
                    print("="*50 + "\n")
                else:
                    # Not our turn, just show status
                    game_state = state.get("gameState", {})
                    stage = game_state.get("stage", "unknown")
                    pot = game_state.get("pot", 0)
                    current_bet = game_state.get("currentBet", 0)
                    
                    print(f"⏳ Waiting... Stage: {stage}, Pot: {pot}, Current bet: {current_bet}")
                
                # Wait before next poll
                time.sleep(poll_interval)
                
            except KeyboardInterrupt:
                print("\n\n🛑 Agent stopped by user")
                break
            except Exception as e:
                print(f"❌ Unexpected error: {e}")
                consecutive_errors += 1
                if consecutive_errors >= max_errors:
                    print(f"❌ Too many errors ({max_errors}), stopping.")
                    break
                time.sleep(poll_interval)

def main():
    parser = argparse.ArgumentParser(description="Simple Poker Agent Bot")
    parser.add_argument("--token", required=True, help="JWT authentication token")
    parser.add_argument("--game-id", required=True, help="Game ID to join")
    parser.add_argument("--user-id", required=True, type=int, help="Your user ID")
    parser.add_argument("--api-base", default="http://localhost:8001/api/v1", 
                       help="Base URL for Agent API")
    parser.add_argument("--poll-interval", type=float, default=2.0,
                       help="Seconds between state polls (default: 2.0)")
    
    args = parser.parse_args()
    
    # Create and run agent
    agent = PokerAgent(
        token=args.token,
        game_id=args.game_id,
        user_id=args.user_id,
        api_base=args.api_base
    )
    
    agent.run(poll_interval=args.poll_interval)

if __name__ == "__main__":
    main()
