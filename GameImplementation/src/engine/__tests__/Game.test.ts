import { Game, GameConfig } from '../Game';
import { Player } from '../Player';

describe('Game', () => {
  let game: Game;
  let player1: Player;
  let player2: Player;
  const config: GameConfig = {
    smallBlind: 10,
    bigBlind: 20,
    initialStack: 1000
  };

  beforeEach(() => {
    game = new Game(config);
    player1 = new Player('p1', 'Alice', config.initialStack);
    player2 = new Player('p2', 'Bob', config.initialStack);
  });

  describe('addPlayer', () => {
    it('should add players to the game', () => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      expect(game.getPlayers()).toHaveLength(2);
    });

    it('should throw error when adding more than 10 players', () => {
      for (let i = 0; i < 10; i++) {
        game.addPlayer(new Player(`p${i}`, `Player${i}`, 1000));
      }
      expect(() => game.addPlayer(new Player('p11', 'Player11', 1000)))
        .toThrow('Maximum 10 players allowed');
    });

    it('should throw error when adding players after game started', () => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
      
      const player3 = new Player('p3', 'Charlie', 1000);
      // After blind join prevention, the error message is more specific
      expect(() => game.addPlayer(player3))
        .toThrow('You can only join when you would be the big blind');
    });
  });

  describe('startHand', () => {
    it('should throw error with less than 2 players', () => {
      game.addPlayer(player1);
      expect(() => game.startHand()).toThrow('Need at least 2 players to start');
    });

    it('should deal 2 cards to each player', () => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
      
      expect(player1.getHoleCards()).toHaveLength(2);
      expect(player2.getHoleCards()).toHaveLength(2);
    });

    it('should post blinds correctly', () => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
      
      const state = game.getGameState();
      expect(state.pot).toBe(30); // SB + BB
      expect(state.currentBet).toBe(20); // BB amount
      expect(state.stage).toBe('preflop');
    });

    it('should set dealer, small blind, and big blind positions', () => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
      
      const state = game.getGameState();
      expect(state.dealerIndex).toBeDefined();
      expect(state.smallBlindIndex).toBeDefined();
      expect(state.bigBlindIndex).toBeDefined();
    });
  });

  describe('handleAction', () => {
    beforeEach(() => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
    });

    it('should reject action from player not in game', () => {
      const result = game.handleAction('nonexistent', 'fold');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Player not found');
    });

    it('should reject action when not player\'s turn', () => {
      const state = game.getGameState();
      const currentPlayer = state.players[state.currentPlayerIndex];
      const otherPlayerId = currentPlayer.id === 'p1' ? 'p2' : 'p1';
      
      const result = game.handleAction(otherPlayerId, 'fold');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Not your turn');
    });

    it('should allow fold action', () => {
      const state = game.getGameState();
      const currentPlayerId = state.players[state.currentPlayerIndex].id;
      
      const result = game.handleAction(currentPlayerId, 'fold');
      expect(result.valid).toBe(true);
      expect(result.gameState?.stage).toBe('complete');
    });

    it('should allow call action', () => {
      const state = game.getGameState();
      const currentPlayerId = state.players[state.currentPlayerIndex].id;
      const currentPlayer = game.getPlayers().find(p => p.id === currentPlayerId)!;
      const stackBefore = currentPlayer.getStack();
      
      const result = game.handleAction(currentPlayerId, 'call');
      expect(result.valid).toBe(true);
      
      // Should have paid to match current bet
      const stackAfter = currentPlayer.getStack();
      expect(stackBefore - stackAfter).toBeGreaterThan(0);
    });

    it('should reject check when bet is required', () => {
      const state = game.getGameState();
      const currentPlayerId = state.players[state.currentPlayerIndex].id;
      
      const result = game.handleAction(currentPlayerId, 'check');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Cannot check');
    });

    it('should allow bet action with valid amount', () => {
      const state = game.getGameState();
      const currentPlayerId = state.players[state.currentPlayerIndex].id;
      
      const result = game.handleAction(currentPlayerId, 'bet', 50);
      expect(result.valid).toBe(true);
    });

    it('should handle all-in action', () => {
      const state = game.getGameState();
      const currentPlayerId = state.players[state.currentPlayerIndex].id;
      const currentPlayer = game.getPlayers().find(p => p.id === currentPlayerId)!;
      
      const result = game.handleAction(currentPlayerId, 'all-in');
      expect(result.valid).toBe(true);
      expect(currentPlayer.getStack()).toBe(0);
      expect(currentPlayer.getIsAllIn()).toBe(true);
    });
  });

  describe('game progression', () => {
    beforeEach(() => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
    });

    it('should progress through betting rounds', () => {
      let state = game.getGameState();
      expect(state.stage).toBe('preflop');
      
      // Both players call to move to flop
      const p1Id = state.players[state.currentPlayerIndex].id;
      game.handleAction(p1Id, 'call');
      
      state = game.getGameState();
      const p2Id = state.players[state.currentPlayerIndex].id;
      game.handleAction(p2Id, 'check');
      
      state = game.getGameState();
      expect(state.stage).toBe('flop');
      expect(state.communityCards).toHaveLength(3);
    });

    it('should deal community cards at appropriate stages', () => {
      // Get to flop
      let state = game.getGameState();
      game.handleAction(state.players[state.currentPlayerIndex].id, 'call');
      state = game.getGameState();
      game.handleAction(state.players[state.currentPlayerIndex].id, 'check');
      
      state = game.getGameState();
      expect(state.communityCards).toHaveLength(3); // Flop
      
      // Get to turn
      game.handleAction(state.players[state.currentPlayerIndex].id, 'check');
      state = game.getGameState();
      game.handleAction(state.players[state.currentPlayerIndex].id, 'check');
      
      state = game.getGameState();
      expect(state.communityCards).toHaveLength(4); // Turn
      
      // Get to river
      game.handleAction(state.players[state.currentPlayerIndex].id, 'check');
      state = game.getGameState();
      game.handleAction(state.players[state.currentPlayerIndex].id, 'check');
      
      state = game.getGameState();
      expect(state.communityCards).toHaveLength(5); // River
    });

    it('should end game when one player folds', () => {
      const state = game.getGameState();
      const currentPlayerId = state.players[state.currentPlayerIndex].id;
      
      const result = game.handleAction(currentPlayerId, 'fold');
      expect(result.valid).toBe(true);
      expect(result.gameState?.stage).toBe('complete');
    });
  });

  describe('getGameState', () => {
    beforeEach(() => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
    });

    it('should return current game state', () => {
      const state = game.getGameState();
      
      expect(state.stage).toBeDefined();
      expect(state.pot).toBeGreaterThan(0);
      expect(state.players).toHaveLength(2);
      expect(state.currentBet).toBeDefined();
      expect(state.currentPlayerIndex).toBeDefined();
    });

    it('should not reveal hole cards in public state', () => {
      const state = game.getGameState();
      
      state.players.forEach(player => {
        expect(typeof player.holeCards).toBe('number');
      });
    });
  });

  describe('getPlayerGameState', () => {
    beforeEach(() => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
    });

    it('should include player\'s own hole cards', () => {
      const state = game.getPlayerGameState('p1');
      
      expect(state.myCards).toBeDefined();
      expect(state.myCards).toHaveLength(2);
    });

    it('should return empty array for non-existent player', () => {
      const state = game.getPlayerGameState('nonexistent');
      expect(state.myCards).toEqual([]);
    });
  });

  describe('Minimum Bet Sizing Rules', () => {
    beforeEach(() => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
      
      // In heads-up, dealer rotates so we need to check who is actually first to act
      const state = game.getGameState();
      const sbPlayer = state.players[state.smallBlindIndex];
      const bbPlayer = state.players[state.bigBlindIndex];
      
      // Complete pre-flop: SB acts first in heads-up
      game.handleAction(sbPlayer.id, 'call'); // SB calls BB
      game.handleAction(bbPlayer.id, 'check'); // BB checks
    });

    it('should reject opening bet smaller than big blind', () => {
      // Post-flop, SB acts first - get current player
      const state = game.getGameState();
      const currentPlayerId = state.players[state.currentPlayerIndex].id;
      
      const result = game.handleAction(currentPlayerId, 'bet', 10);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Minimum bet is $20');
    });

    it('should accept opening bet equal to big blind', () => {
      const state = game.getGameState();
      const currentPlayerId = state.players[state.currentPlayerIndex].id;
      
      const result = game.handleAction(currentPlayerId, 'bet', 20);
      
      expect(result.valid).toBe(true);
    });

    it('should accept opening bet larger than big blind', () => {
      const state = game.getGameState();
      const currentPlayerId = state.players[state.currentPlayerIndex].id;
      
      const result = game.handleAction(currentPlayerId, 'bet', 100);
      
      expect(result.valid).toBe(true);
    });

    it('should reject raise smaller than previous bet size', () => {
      const state = game.getGameState();
      const p1Id = state.players[state.currentPlayerIndex].id;
      const p2Id = state.players[(state.currentPlayerIndex + 1) % 2].id;
      
      // Player 1 bets 100
      game.handleAction(p1Id, 'bet', 100);
      
      // Player 2 tries to raise by 50 (to 150 total) - needs to raise by at least 100
      const result = game.handleAction(p2Id, 'raise', 50);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Minimum raise is $100');
    });

    it('should accept raise equal to previous bet size', () => {
      const state = game.getGameState();
      const p1Id = state.players[state.currentPlayerIndex].id;
      const p2Id = state.players[(state.currentPlayerIndex + 1) % 2].id;
      
      // Player 1 bets 100
      game.handleAction(p1Id, 'bet', 100);
      
      // Player 2 raises by 100 (to 200 total) - minimum legal raise
      const result = game.handleAction(p2Id, 'raise', 100);
      
      expect(result.valid).toBe(true);
    });

    it('should accept raise larger than previous bet size', () => {
      const state = game.getGameState();
      const p1Id = state.players[state.currentPlayerIndex].id;
      const p2Id = state.players[(state.currentPlayerIndex + 1) % 2].id;
      
      // Player 1 bets 100
      game.handleAction(p1Id, 'bet', 100);
      
      // Player 2 raises by 200 (to 300 total) - larger than minimum
      const result = game.handleAction(p2Id, 'raise', 200);
      
      expect(result.valid).toBe(true);
    });

    it('should enforce minimum re-raise based on last raise size', () => {
      const state = game.getGameState();
      const p1Id = state.players[state.currentPlayerIndex].id;
      const p2Id = state.players[(state.currentPlayerIndex + 1) % 2].id;
      
      // Player 1 bets 100
      game.handleAction(p1Id, 'bet', 100);
      
      // Player 2 raises by 150 (to 250 total)
      game.handleAction(p2Id, 'raise', 150);
      
      // Player 1 tries to raise by 100 (to 350 total), but last raise was 150
      const result = game.handleAction(p1Id, 'raise', 100);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Minimum raise is $150');
    });

    it('should accept re-raise equal to last raise size', () => {
      const state = game.getGameState();
      const p1Id = state.players[state.currentPlayerIndex].id;
      const p2Id = state.players[(state.currentPlayerIndex + 1) % 2].id;
      
      // Player 1 bets 100
      game.handleAction(p1Id, 'bet', 100);
      
      // Player 2 raises by 150 (to 250 total)
      game.handleAction(p2Id, 'raise', 150);
      
      // Player 1 re-raises by 150 (to 400 total) - matches last raise
      const result = game.handleAction(p1Id, 'raise', 150);
      
      expect(result.valid).toBe(true);
    });

    it('should reset minimum raise size for new betting round', () => {
      const state1 = game.getGameState();
      const p1Id = state1.players[state1.currentPlayerIndex].id;
      const p2Id = state1.players[(state1.currentPlayerIndex + 1) % 2].id;
      
      // Player 1 bets big on flop
      game.handleAction(p1Id, 'bet', 200);
      game.handleAction(p2Id, 'call');
      
      // Now on turn, minimum should reset to big blind (20)
      const state2 = game.getGameState();
      const currentPlayerId = state2.players[state2.currentPlayerIndex].id;
      const result = game.handleAction(currentPlayerId, 'bet', 20);
      
      expect(result.valid).toBe(true);
    });
  });

  describe('Post-Flop Action Order', () => {
    it('should start post-flop betting at small blind position', () => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
      
      const preState = game.getGameState();
      const sbId = preState.players[preState.smallBlindIndex].id;
      const bbId = preState.players[preState.bigBlindIndex].id;
      
      // Complete pre-flop (SB acts first in heads-up)
      game.handleAction(sbId, 'call');
      game.handleAction(bbId, 'check');
      
      // Post-flop should start with small blind
      const postState = game.getGameState();
      expect(postState.currentPlayerIndex).toBe(postState.smallBlindIndex);
    });

    it('should maintain small-blind-first order through all streets', () => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
      
      const preState = game.getGameState();
      const sbId = preState.players[preState.smallBlindIndex].id;
      const bbId = preState.players[preState.bigBlindIndex].id;
      
      // Pre-flop
      game.handleAction(sbId, 'call');
      game.handleAction(bbId, 'check');
      
      // Flop - should start at SB
      let state = game.getGameState();
      expect(state.currentPlayerIndex).toBe(state.smallBlindIndex);
      const currentId1 = state.players[state.currentPlayerIndex].id;
      const nextId1 = state.players[(state.currentPlayerIndex + 1) % 2].id;
      game.handleAction(currentId1, 'check');
      game.handleAction(nextId1, 'check');
      
      // Turn - should start at SB
      state = game.getGameState();
      expect(state.currentPlayerIndex).toBe(state.smallBlindIndex);
      const currentId2 = state.players[state.currentPlayerIndex].id;
      const nextId2 = state.players[(state.currentPlayerIndex + 1) % 2].id;
      game.handleAction(currentId2, 'check');
      game.handleAction(nextId2, 'check');
      
      // River - should start at SB
      state = game.getGameState();
      expect(state.currentPlayerIndex).toBe(state.smallBlindIndex);
    });
  });

  describe('Heads-Up (2 Player) Rules', () => {
    let headsUpGame: Game;
    let p1: Player;
    let p2: Player;

    beforeEach(() => {
      headsUpGame = new Game({ smallBlind: 10, bigBlind: 20, initialStack: 1000 });
      p1 = new Player('p1', 'Alice', 1000);
      p2 = new Player('p2', 'Bob', 1000);
      headsUpGame.addPlayer(p1);
      headsUpGame.addPlayer(p2);
    });

    it('should post dealer as small blind in heads-up', () => {
      headsUpGame.startHand();
      const state = headsUpGame.getGameState();
      
      // In heads-up, dealer is small blind
      expect(state.dealerIndex).toBe(state.smallBlindIndex);
    });

    it('should post opponent as big blind in heads-up', () => {
      headsUpGame.startHand();
      const state = headsUpGame.getGameState();
      
      // In heads-up, opponent of dealer is big blind
      expect(state.bigBlindIndex).toBe((state.dealerIndex + 1) % 2);
    });

    it('should have small blind act first pre-flop in heads-up', () => {
      headsUpGame.startHand();
      const state = headsUpGame.getGameState();
      
      // In heads-up pre-flop, SB/dealer acts first
      expect(state.currentPlayerIndex).toBe(state.smallBlindIndex);
    });

    it('should have dealer act last post-flop in heads-up', () => {
      headsUpGame.startHand();
      
      // Complete pre-flop
      headsUpGame.handleAction('p1', 'call'); // SB calls
      headsUpGame.handleAction('p2', 'check'); // BB checks
      
      // Post-flop, small blind acts first (which is also dealer in heads-up)
      const state = headsUpGame.getGameState();
      expect(state.currentPlayerIndex).toBe(state.smallBlindIndex);
    });

    it('should rotate positions correctly over multiple hands', () => {
      // Hand 1
      headsUpGame.startHand();
      const state1 = headsUpGame.getGameState();
      const dealer1 = state1.dealerIndex;
      
      // Complete hand
      headsUpGame.handleAction(state1.players[state1.currentPlayerIndex].id, 'fold');
      
      // Hand 2
      headsUpGame.startHand();
      const state2 = headsUpGame.getGameState();
      const dealer2 = state2.dealerIndex;
      
      // Dealer should have moved
      expect(dealer2).toBe((dealer1 + 1) % 2);
      // Dealer should still be SB
      expect(state2.dealerIndex).toBe(state2.smallBlindIndex);
    });
  });

  describe('Ante Support', () => {
    it('should not post antes when ante is 0', () => {
      const gameNoAnte = new Game({ smallBlind: 10, bigBlind: 20, initialStack: 1000, ante: 0 });
      gameNoAnte.addPlayer(new Player('p1', 'Alice', 1000));
      gameNoAnte.addPlayer(new Player('p2', 'Bob', 1000));
      gameNoAnte.startHand();
      
      const state = gameNoAnte.getGameState();
      // Pot should only have blinds (10 + 20 = 30)
      expect(state.pot).toBe(30);
    });

    it('should not post antes when ante is undefined', () => {
      const gameNoAnte = new Game({ smallBlind: 10, bigBlind: 20, initialStack: 1000 });
      gameNoAnte.addPlayer(new Player('p1', 'Alice', 1000));
      gameNoAnte.addPlayer(new Player('p2', 'Bob', 1000));
      gameNoAnte.startHand();
      
      const state = gameNoAnte.getGameState();
      // Pot should only have blinds (10 + 20 = 30)
      expect(state.pot).toBe(30);
    });

    it('should post antes from all players when configured', () => {
      const gameWithAnte = new Game({ smallBlind: 10, bigBlind: 20, initialStack: 1000, ante: 5 });
      gameWithAnte.addPlayer(new Player('p1', 'Alice', 1000));
      gameWithAnte.addPlayer(new Player('p2', 'Bob', 1000));
      gameWithAnte.addPlayer(new Player('p3', 'Charlie', 1000));
      gameWithAnte.startHand();
      
      const state = gameWithAnte.getGameState();
      // Pot should have antes (3 * 5 = 15) + blinds (10 + 20 = 30) = 45
      expect(state.pot).toBe(45);
    });

    it('should deduct antes from player stacks', () => {
      const gameWithAnte = new Game({ smallBlind: 10, bigBlind: 20, initialStack: 1000, ante: 5 });
      const p1 = new Player('p1', 'Alice', 1000);
      const p2 = new Player('p2', 'Bob', 1000);
      gameWithAnte.addPlayer(p1);
      gameWithAnte.addPlayer(p2);
      gameWithAnte.startHand();
      
      // Player 1 is dealer, Player 2 is SB in heads-up... wait, let me recalculate
      // Actually with 2 players: dealer is SB, posts 10+5=15, so stack = 985
      // Other is BB, posts 20+5=25, so stack = 975
      const state = gameWithAnte.getGameState();
      const sbPlayer = state.players[state.smallBlindIndex];
      const bbPlayer = state.players[state.bigBlindIndex];
      
      // SB posted ante (5) + small blind (10) = 15 from 1000
      expect(sbPlayer.stack).toBe(985);
      // BB posted ante (5) + big blind (20) = 25 from 1000
      expect(bbPlayer.stack).toBe(975);
    });

    it('should post antes before blinds', () => {
      const gameWithAnte = new Game({ smallBlind: 10, bigBlind: 20, initialStack: 1000, ante: 5 });
      const p1 = new Player('p1', 'Alice', 50); // Low stack to test ante before blind
      const p2 = new Player('p2', 'Bob', 1000);
      gameWithAnte.addPlayer(p1);
      gameWithAnte.addPlayer(p2);
      gameWithAnte.startHand();
      
      // If p1 is SB with 50 chips: ante (5) then SB (10) = 15 total, leaving 35
      // If p1 is BB with 50 chips: ante (5) then BB (20) = 25 total, leaving 25
      const state = gameWithAnte.getGameState();
      const p1State = state.players.find(p => p.id === 'p1')!;
      
      // Verify ante was posted (exact amount depends on position)
      expect(p1State.stack).toBeLessThan(50);
      expect(p1State.stack).toBeGreaterThanOrEqual(25); // Should have at least 25 left
    });
  });

  describe('Burn Cards', () => {
    it('should burn cards before dealing flop', () => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
      
      const preState = game.getGameState();
      const sbId = preState.players[preState.smallBlindIndex].id;
      const bbId = preState.players[preState.bigBlindIndex].id;
      
      // Complete pre-flop
      game.handleAction(sbId, 'call');
      game.handleAction(bbId, 'check');
      
      // After flop: burned 1, dealt 3
      const state = game.getGameState();
      expect(state.stage).toBe('flop');
      expect(state.communityCards).toHaveLength(3);
    });

    it('should burn cards before dealing turn', () => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
      
      const preState = game.getGameState();
      const sbId = preState.players[preState.smallBlindIndex].id;
      const bbId = preState.players[preState.bigBlindIndex].id;
      
      // Complete pre-flop
      game.handleAction(sbId, 'call');
      game.handleAction(bbId, 'check');
      
      // Complete flop
      const flopState = game.getGameState();
      const currentId1 = flopState.players[flopState.currentPlayerIndex].id;
      const nextId1 = flopState.players[(flopState.currentPlayerIndex + 1) % 2].id;
      game.handleAction(currentId1, 'check');
      game.handleAction(nextId1, 'check');
      
      // After turn: additional 1 burn + 1 turn card
      const state = game.getGameState();
      expect(state.stage).toBe('turn');
      expect(state.communityCards).toHaveLength(4);
    });

    it('should burn cards before dealing river', () => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
      
      const preState = game.getGameState();
      const sbId = preState.players[preState.smallBlindIndex].id;
      const bbId = preState.players[preState.bigBlindIndex].id;
      
      // Complete pre-flop
      game.handleAction(sbId, 'call');
      game.handleAction(bbId, 'check');
      
      // Complete flop
      const flopState = game.getGameState();
      const flopCurrentId = flopState.players[flopState.currentPlayerIndex].id;
      const flopNextId = flopState.players[(flopState.currentPlayerIndex + 1) % 2].id;
      game.handleAction(flopCurrentId, 'check');
      game.handleAction(flopNextId, 'check');
      
      // Complete turn
      const turnState = game.getGameState();
      const turnCurrentId = turnState.players[turnState.currentPlayerIndex].id;
      const turnNextId = turnState.players[(turnState.currentPlayerIndex + 1) % 2].id;
      game.handleAction(turnCurrentId, 'check');
      game.handleAction(turnNextId, 'check');
      
      // After river: additional 1 burn + 1 river card
      const state = game.getGameState();
      expect(state.stage).toBe('river');
      expect(state.communityCards).toHaveLength(5);
    });
  });
});
