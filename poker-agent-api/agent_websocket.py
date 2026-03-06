#!/usr/bin/env python3
"""
WebSocket Poker Agent Bot (Chunk 6 - Real-time)

This agent connects directly to the Node.js Game Server via WebSocket.
It's event-driven and receives game updates instantly (no polling).

Usage:
    1. Register a user and get a JWT token
    2. Join a table and get the game ID
    3. Run this script:
    
    python agent_websocket.py --token YOUR_JWT_TOKEN --game-id GAME_ID --user-id YOUR_USER_ID

Architecture:
    - Connects to game server WebSocket (port 3000)
    - Listens for 'game_state_update' events
    - Emits 'game_action' events when it's our turn
    - No polling, no intermediate API layer
"""

import socketio
import argparse
import sys
import time
import re
import os
from typing import Optional, Tuple

class WebSocketPokerAgent:
    """
    Real-time poker agent using WebSocket connection to game server.
    """
    
    def __init__(
        self,
        token: str,
        game_id: str,
        user_id: int,
        server_url: str = "http://localhost:3000",
        action_delay_seconds: float = 0.0
    ):
        self.token = token
        self.game_id = game_id
        self.user_id = user_id
        self.server_url = server_url
        self.table_id = self._extract_table_id(game_id)
        self.action_delay_seconds = max(0.0, action_delay_seconds)
        self.my_player_id: Optional[str] = None
        self.connected = False
        self.game_started = False
        
        # Create Socket.IO client
        self.sio = socketio.Client(logger=False, engineio_logger=False)
        
        # Register event handlers
        self.setup_event_handlers()
    
    def setup_event_handlers(self):
        """Register all Socket.IO event handlers"""
        
        @self.sio.event
        def connect():
            """Called when connection is established"""
            print("✅ Connected to game server!")
            self.connected = True
            print(f"👂 Waiting for game updates (game_id: {self.game_id})...")
        
        @self.sio.event
        def disconnect():
            """Called when connection is lost"""
            print("❌ Disconnected from game server")
            self.connected = False
        
        @self.sio.event
        def connect_error(data):
            """Called when connection fails"""
            print(f"❌ Connection error: {data}")
            self.connected = False
        
        @self.sio.on('game_state_update')
        def on_game_state_update(data):
            """
            Called when game state changes.
            This is the core event - we receive updates in real-time.
            """
            payload_game_id = data.get('gameId')
            if payload_game_id and payload_game_id != self.game_id:
                return

            game_state = data.get('gameState', {})
            
            if not self.game_started:
                print("🎲 Game started! Receiving updates...")
                self.game_started = True
            
            # Identify our player if we haven't yet
            if self.my_player_id is None:
                self.identify_my_player(game_state)
            
            # Check if it's our turn
            if self.is_my_turn(game_state):
                self.handle_my_turn(game_state)
        
        @self.sio.on('action_result')
        def on_action_result(data):
            """Called when our action is processed"""
            if data.get('success'):
                print(f"✅ Action accepted: {data.get('action')}")
            else:
                print(f"❌ Action rejected: {data.get('error', 'Unknown error')}")
        
        @self.sio.on('error')
        def on_error(data):
            """Called when an error occurs"""
            print(f"❌ Server error: {data}")
        
        @self.sio.on('player_joined')
        def on_player_joined(data):
            """Called when a player joins"""
            player_name = data.get('playerName', 'Unknown')
            print(f"👤 Player joined: {player_name}")
        
        @self.sio.on('player_left')
        def on_player_left(data):
            """Called when a player leaves"""
            player_name = data.get('playerName', 'Unknown')
            print(f"👋 Player left: {player_name}")
        
        @self.sio.on('hand_complete')
        def on_hand_complete(data):
            """Called when a hand finishes"""
            winner = data.get('winner', {})
            print(f"🏆 Hand complete! Winner: {winner.get('playerName')} - Won: {winner.get('amount')}")
    
    def identify_my_player(self, game_state: dict):
        """
        Identify which player in the game is us.
        Prefer deterministic user-id matching from player ids.
        Fall back to the legacy "visible hole cards" heuristic.
        """
        players = game_state.get('players', [])

        # Primary strategy: match player_<userId>_<ts> id pattern against our user id.
        for player in players:
            player_id = str(player.get('id', ''))
            if player_id.startswith(f'player_{self.user_id}_'):
                self.my_player_id = player_id
                player_name = player.get('name', 'Unknown')
                stack = player.get('stack', 0)
                print(f"🆔 Identified myself by user id: {player_name} (ID: {self.my_player_id}, Stack: {stack})")
                return

        # Fallback for legacy payload shapes.
        for player in players:
            hole_cards = player.get('holeCards', [])
            
            # Our cards have full details, others are hidden
            # Check if hole_cards is a list (not an int or other type)
            if isinstance(hole_cards, list) and len(hole_cards) > 0:
                first_card = hole_cards[0]
                if isinstance(first_card, dict) and 'suit' in first_card:
                    self.my_player_id = player.get('id')
                    player_name = player.get('name', 'Unknown')
                    stack = player.get('stack', 0)
                    print(f"🆔 Identified myself by hole cards: {player_name} (ID: {self.my_player_id}, Stack: {stack})")
                    return
    
    def is_my_turn(self, game_state: dict) -> bool:
        """Check if it's currently our turn to act"""
        if self.my_player_id is None:
            return False
        
        current_player_index = game_state.get('currentPlayerIndex')
        if current_player_index is None:
            return False
        
        players = game_state.get('players', [])
        if not (0 <= current_player_index < len(players)):
            return False
        
        current_player = players[current_player_index]
        is_my_turn = current_player.get('id') == self.my_player_id
        
        if is_my_turn:
            print(f"\n🎯 It's my turn! Current pot: {game_state.get('pot', 0)}")
        
        return is_my_turn
    
    def handle_my_turn(self, game_state: dict):
        """
        Decide what action to take and emit it.
        This is called when it's our turn.
        """
        # Get current game information
        current_bet = game_state.get('currentBet', 0)
        pot = game_state.get('pot', 0)
        community_cards = game_state.get('communityCards', [])
        
        # Find my player info
        my_player = None
        for player in game_state.get('players', []):
            if player.get('id') == self.my_player_id:
                my_player = player
                break
        
        if not my_player:
            print("❌ Could not find my player info!")
            self.sio.emit('game_action', {'action': 'fold'})
            return
        
        # Get my situation
        my_stack = my_player.get('stack', 0)
        my_current_bet = my_player.get('currentBet', 0)
        my_hole_cards = game_state.get('myCards', [])
        amount_to_call = current_bet - my_current_bet
        
        # Log situation
        print(f"💭 Thinking...")
        print(f"   My stack: {my_stack}")
        print(f"   Current bet: {current_bet}")
        print(f"   My bet: {my_current_bet}")
        print(f"   To call: {amount_to_call}")
        print(f"   Pot: {pot}")
        print(f"   My cards: {self.format_cards(my_hole_cards)}")
        print(f"   Community: {self.format_cards(community_cards)}")
        
        # Decide action using simple strategy
        action_type, amount = self.decide_action(
            current_bet=current_bet,
            my_stack=my_stack,
            my_current_bet=my_current_bet,
            pot=pot,
            my_cards=my_hole_cards,
            community_cards=community_cards
        )
        
        # Emit the action
        action_data = {'action': action_type}
        if amount is not None:
            action_data['amount'] = amount

        if self.action_delay_seconds > 0:
            print(f"⏱️  Test delay: waiting {self.action_delay_seconds:.1f}s before action...")
            time.sleep(self.action_delay_seconds)

        print(f"🎲 Taking action: {action_type}" + (f" (amount: {amount})" if amount else ""))
        self.sio.emit('game_action', action_data)
    
    def decide_action(
        self,
        current_bet: int,
        my_stack: int,
        my_current_bet: int,
        pot: int,
        my_cards: list,
        community_cards: list
    ) -> Tuple[str, Optional[int]]:
        """
        Simple poker strategy:
        - If no bet, check
        - If there's a bet, call if we can afford it
        - Never bet or raise (conservative bot)
        
        Returns (action_type, amount)
        """
        amount_to_call = current_bet - my_current_bet
        
        # If no bet, check
        if current_bet == 0 or amount_to_call == 0:
            return ('check', None)
        
        # If we can afford to call, call
        if amount_to_call <= my_stack:
            return ('call', None)
        
        # If we can't afford to call, go all-in (if we have chips)
        if my_stack > 0:
            return ('all-in', None)
        
        # Last resort: fold
        return ('fold', None)
    
    def format_cards(self, cards: list) -> str:
        """Format cards for display"""
        if not cards:
            return "none"
        
        formatted = []
        for card in cards:
            if isinstance(card, dict):
                rank = card.get('rank', '?')
                suit = card.get('suit', '?')
                # Use suit symbols
                suit_symbol = {'hearts': '♥', 'diamonds': '♦', 'clubs': '♣', 'spades': '♠'}.get(suit, suit)
                formatted.append(f"{rank}{suit_symbol}")
            else:
                formatted.append(str(card))
        
        return ' '.join(formatted)
    
    def connect_and_play(self):
        """
        Main entry point - connect to server and start playing.
        This will block until disconnected.
        """
        try:
            print(f"🤖 WebSocket Poker Agent starting...")
            print(f"   Server: {self.server_url}")
            print(f"   Game ID: {self.game_id}")
            if self.table_id is not None:
                print(f"   Table ID: {self.table_id}")
            print(f"   User ID: {self.user_id}")
            print(f"\n🔌 Connecting...")

            # Connect with JWT authentication
            auth_payload = {
                'token': self.token,
                'gameId': self.game_id,
            }
            if self.table_id is not None:
                auth_payload['tableId'] = self.table_id

            self.sio.connect(
                self.server_url,
                auth=auth_payload,
                wait_timeout=10
            )
            
            # Wait for events (blocks forever)
            print("👂 Listening for game events...\n")
            self.sio.wait()
            
        except socketio.exceptions.ConnectionError as e:
            print(f"\n❌ Failed to connect to game server: {e}")
            print("   Make sure the game server is running on port 3000")
            sys.exit(1)
        except KeyboardInterrupt:
            print("\n\n👋 Agent shutting down...")
            if self.connected:
                self.sio.disconnect()
            sys.exit(0)
        except Exception as e:
            print(f"\n❌ Unexpected error: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)

    @staticmethod
    def _extract_table_id(game_id: str) -> Optional[int]:
        match = re.match(r'^table_(\d+)$', game_id.strip())
        if not match:
            return None
        return int(match.group(1))

def main():
    """Parse arguments and start the agent"""
    parser = argparse.ArgumentParser(description='WebSocket Poker Agent Bot')
    parser.add_argument('--token', required=True, help='JWT authentication token')
    parser.add_argument('--game-id', required=True, help='Game/table ID to join')
    parser.add_argument('--user-id', required=True, type=int, help='Your user ID')
    parser.add_argument('--server', default='http://localhost:3000', help='Game server URL (default: http://localhost:3000)')
    parser.add_argument(
        '--action-delay-seconds',
        type=float,
        default=float(os.getenv('POKER_BOT_ACTION_DELAY_SECONDS', '0')),
        help='Optional delay before each action (testing/spectate aid). Default: 0'
    )
    
    args = parser.parse_args()
    
    # Create and run agent
    agent = WebSocketPokerAgent(
        token=args.token,
        game_id=args.game_id,
        user_id=args.user_id,
        server_url=args.server,
        action_delay_seconds=args.action_delay_seconds
    )
    
    agent.connect_and_play()

if __name__ == '__main__':
    main()
