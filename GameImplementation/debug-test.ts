import { Game, GameConfig } from './src/engine/Game';
import { Player } from './src/engine/Player';

// Debug test to see what's happening
const config: GameConfig = {
  smallBlind: 10,
  bigBlind: 20,
  initialStack: 1000
};

const game = new Game(config);
const player1 = new Player('p1', 'Alice', config.initialStack);
const player2 = new Player('p2', 'Bob', config.initialStack);

game.addPlayer(player1);
game.addPlayer(player2);
game.startHand();

console.log('Initial state:', game.getGameState().stage, 'Community cards:', game.getGameState().communityCards.length);

// Get to flop
let state = game.getGameState();
console.log('Current player:', state.players[state.currentPlayerIndex].name, 'Current bet:', state.currentBet);
game.handleAction(state.players[state.currentPlayerIndex].id, 'call');

state = game.getGameState();
console.log('After call - Current player:', state.players[state.currentPlayerIndex].name, 'Current bet:', state.currentBet);
console.log('Player bets:', state.players.map(p => `${p.name}: ${p.totalBetThisRound}`));
game.handleAction(state.players[state.currentPlayerIndex].id, 'check');

state = game.getGameState();
console.log('After check - Stage:', state.stage, 'Community cards:', state.communityCards.length);

// Get to turn
console.log('\n--- Trying to get to turn ---');
console.log('Current player:', state.players[state.currentPlayerIndex].name);
console.log('Player bets:', state.players.map(p => `${p.name}: ${p.totalBetThisRound}`));
game.handleAction(state.players[state.currentPlayerIndex].id, 'check');

state = game.getGameState();
console.log('After first check - Stage:', state.stage, 'Community cards:', state.communityCards.length);
console.log('Current player:', state.players[state.currentPlayerIndex].name);
console.log('Player bets:', state.players.map(p => `${p.name}: ${p.totalBetThisRound}`));
game.handleAction(state.players[state.currentPlayerIndex].id, 'check');

state = game.getGameState();
console.log('After second check - Stage:', state.stage, 'Community cards:', state.communityCards.length);
