import { io, Socket } from 'socket.io-client';
import * as readline from 'readline';
import { Card } from './engine/Card';
import { GameState } from './engine/Game';

const SERVER_URL = 'http://localhost:3000';

/**
 * Command-line test client for playing poker
 */
class PokerClient {
  private socket: Socket;
  private rl: readline.Interface;
  private playerId: string = '';
  private gameId: string = '';
  private currentGameState: (GameState & { myCards?: Card[] }) | null = null;

  constructor(playerName: string) {
    this.socket = io(SERVER_URL);
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    this.setupSocketHandlers();
    
    // Join lobby
    this.socket.emit('join_lobby', { playerName });
    console.log(`\n🎰 Connecting as "${playerName}"...\n`);
  }

  private setupSocketHandlers(): void {
    this.socket.on('connect', () => {
      console.log('✅ Connected to server\n');
    });

    this.socket.on('lobby_joined', ({ playerId, message, lobbySize }) => {
      this.playerId = playerId;
      console.log(`${message} (${lobbySize} player${lobbySize > 1 ? 's' : ''} in lobby)`);
    });

    this.socket.on('game_started', ({ gameId, yourPlayerId, gameState }) => {
      this.gameId = gameId;
      this.playerId = yourPlayerId;
      console.log('\n🎮 GAME STARTED! 🎮\n');
      console.log('═'.repeat(60));
      this.displayGameState(gameState);
    });

    this.socket.on('game_state_update', ({ gameState }) => {
      this.currentGameState = gameState;
      console.log('\n' + '─'.repeat(60));
      this.displayGameState(gameState);
    });

    this.socket.on('action_error', ({ error }) => {
      console.log(`\n❌ Invalid action: ${error}\n`);
      this.promptAction();
    });

    this.socket.on('player_left', ({ playerName }) => {
      console.log(`\n🚪 ${playerName} left the game`);
      this.cleanup();
    });

    this.socket.on('error', ({ message }) => {
      console.log(`\n⚠️  Error: ${message}`);
    });

    this.socket.on('disconnect', () => {
      console.log('\n❌ Disconnected from server');
      this.cleanup();
    });
  }

  private displayGameState(gameState: GameState & { myCards?: Card[] }): void {
    this.currentGameState = gameState;
    const { stage, pot, communityCards, currentPlayerIndex, currentBet, players, myCards } = gameState;

    console.log(`\n🎲 Stage: ${stage.toUpperCase()}`);
    console.log(`💰 Pot: $${pot}`);
    console.log(`💵 Current Bet: $${currentBet}`);
    
    if (communityCards && communityCards.length > 0) {
      console.log(`\n🃏 Community Cards: ${communityCards.map((c: any) => c.rank + c.suit[0].toUpperCase()).join(' ')}`);
    }

    console.log('\n👥 Players:');
    players.forEach((player: any, index: number) => {
      const isCurrentPlayer = index === currentPlayerIndex;
      const isMe = player.id === this.playerId;
      const marker = isCurrentPlayer ? '▶' : ' ';
      const meMarker = isMe ? '(YOU)' : '';
      
      let status = '';
      if (player.hasFolded) status = '❌ FOLDED';
      else if (player.isAllIn) status = '🔥 ALL-IN';
      else if (!player.isActive) status = '💤 OUT';

      console.log(`${marker} ${player.name} ${meMarker}`);
      console.log(`   💵 Stack: $${player.stack} | Bet: $${player.currentBet} ${status}`);
    });

    if (myCards && myCards.length > 0) {
      console.log(`\n🎴 Your Cards: ${myCards.map((c: any) => c.rank + c.suit[0].toUpperCase()).join(' ')}`);
    }

    // Check if it's my turn
    const currentPlayer = players[currentPlayerIndex];
    if (currentPlayer && currentPlayer.id === this.playerId && !currentPlayer.hasFolded) {
      console.log('\n⏰ IT\'S YOUR TURN!');
      this.promptAction();
    } else if (stage === 'complete') {
      console.log('\n🏆 HAND COMPLETE!');
      console.log('   Starting new hand in 3 seconds...');
    }
  }

  private promptAction(): void {
    if (!this.currentGameState) return;

    const myPlayer = this.currentGameState.players.find((p: any) => p.id === this.playerId);
    if (!myPlayer) return;

    const currentBet = this.currentGameState.currentBet;
    const myCurrentBet = myPlayer.currentBet;
    const toCall = currentBet - myCurrentBet;

    console.log('\n📝 Available Actions:');
    if (toCall === 0) {
      console.log('   • check');
      console.log('   • bet <amount>');
    } else {
      console.log('   • fold');
      console.log(`   • call (pay $${toCall})`);
      console.log('   • raise <amount>');
    }
    console.log('   • all-in');

    this.rl.question('\n> Your action: ', (input) => {
      const parts = input.trim().toLowerCase().split(' ');
      const action = parts[0];
      const amount = parts[1] ? parseInt(parts[1]) : undefined;

      if (['fold', 'check', 'call', 'bet', 'raise', 'all-in'].includes(action)) {
        this.socket.emit('game_action', { action, amount });
      } else {
        console.log('❌ Invalid action. Try again.');
        this.promptAction();
      }
    });
  }

  private cleanup(): void {
    this.rl.close();
    this.socket.close();
    process.exit(0);
  }
}

// Get player name from command line or use default
const playerName = process.argv[2] || `Player_${Math.floor(Math.random() * 1000)}`;
new PokerClient(playerName);
