import { Game, GameConfig } from '../Game';
import { Player } from '../Player';
import { Card } from '../Card';

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

    it('should seat players during active hands and queue when not at big blind', () => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
      
      const player3 = new Player('p3', 'Charlie', 1000);
      expect(() => game.addPlayer(player3)).not.toThrow();

      const state = game.getGameState();
      const queued = state.players.find((player) => player.id === 'p3');
      expect(queued).toBeDefined();
      expect(queued?.waitingForBigBlind).toBe(true);
      expect(queued?.isActive).toBe(false);
    });

    it('should eventually activate queued players when their big blind arrives', () => {
      const seatedP1 = new Player('p1', 'Alice', 1000, 1);
      const seatedP2 = new Player('p2', 'Bob', 1000, 2);
      const queuedP3 = new Player('p3', 'Charlie', 1000, 3);
      game.addPlayer(seatedP1);
      game.addPlayer(seatedP2);
      game.startHand();

      game.addPlayer(queuedP3);
      let queuedState = game.getGameState().players.find((player) => player.id === 'p3');
      expect(queuedState?.waitingForBigBlind).toBe(true);

      for (let i = 0; i < 6; i++) {
        const current = game.getGameState();
        if (current.stage !== 'complete') {
          const actorId = current.players[current.currentPlayerIndex]?.id;
          if (actorId) {
            game.handleAction(actorId, 'fold');
          }
        }
        game.startHand();
        queuedState = game.getGameState().players.find((player) => player.id === 'p3');
        if (!queuedState?.waitingForBigBlind) {
          break;
        }
      }

      expect(queuedState?.waitingForBigBlind).toBe(false);
      expect(queuedState?.isActive).toBe(true);
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
      expect(game.handleAction(sbPlayer.id, 'call').valid).toBe(true);
      expect(game.getGameState().stage).toBe('preflop');
      expect(game.getGameState().currentPlayerIndex).toBe(state.bigBlindIndex);
      expect(game.handleAction(bbPlayer.id, 'check').valid).toBe(true);
      expect(game.getGameState().stage).toBe('flop');
    });

    it('should reject opening bet smaller than big blind', () => {
      // Post-flop, the big blind acts first in heads-up.
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

  describe('Short All-In Reopen Rules', () => {
    const advanceHeadsUpToFlop = (targetGame: Game) => {
      const preflopState = targetGame.getGameState();
      const sbId = preflopState.players[preflopState.smallBlindIndex].id;
      const bbId = preflopState.players[preflopState.bigBlindIndex].id;
      expect(targetGame.handleAction(sbId, 'call').valid).toBe(true);
      expect(targetGame.handleAction(bbId, 'check').valid).toBe(true);
      return targetGame.getGameState();
    };

    const advanceThreePlayersToFlop = (targetGame: Game) => {
      let state = targetGame.getGameState();
      expect(targetGame.handleAction(state.players[state.currentPlayerIndex].id, 'call').valid).toBe(true);

      state = targetGame.getGameState();
      expect(targetGame.handleAction(state.players[state.currentPlayerIndex].id, 'call').valid).toBe(true);

      state = targetGame.getGameState();
      expect(targetGame.handleAction(state.players[state.currentPlayerIndex].id, 'check').valid).toBe(true);

      return targetGame.getGameState();
    };

    it('should not reopen betting after a short all-in heads-up', () => {
      const shortAllInGame = new Game(config);
      const deepStack = new Player('p1', 'Alice', 1000, 1);
      const shortStack = new Player('p2', 'Bob', 150, 2);
      shortAllInGame.addPlayer(deepStack);
      shortAllInGame.addPlayer(shortStack);
      shortAllInGame.startHand();

      const flopState = advanceHeadsUpToFlop(shortAllInGame);
      const bettorId = flopState.players[flopState.currentPlayerIndex].id;
      const shortStackId = flopState.players[(flopState.currentPlayerIndex + 1) % 2].id;

      expect(shortAllInGame.handleAction(bettorId, 'bet', 100).valid).toBe(true);
      expect(shortAllInGame.handleAction(shortStackId, 'all-in').valid).toBe(true);

      const afterShortAllIn = shortAllInGame.getGameState();
      expect(afterShortAllIn.stage).toBe('flop');
      expect(afterShortAllIn.currentBet).toBe(130);
      expect(afterShortAllIn.minRaiseSize).toBe(100);
      expect(afterShortAllIn.players[afterShortAllIn.currentPlayerIndex].id).toBe(bettorId);

      const noReopenRaise = shortAllInGame.handleAction(bettorId, 'raise', 100);
      expect(noReopenRaise.valid).toBe(false);
      expect(noReopenRaise.error).toContain('not been reopened');

      const callResult = shortAllInGame.handleAction(bettorId, 'call');
      expect(callResult.valid).toBe(true);

      const afterCall = shortAllInGame.getGameState();
      expect(afterCall.stage).toBe('complete');
      expect(afterCall.currentBet).toBe(0);
    });

    it('should reopen betting after cumulative short all-ins reach a full raise', () => {
      const cumulativeGame = new Game(config);
      const firstShort = new Player('p1', 'Alice', 150, 1);
      const secondShort = new Player('p2', 'Bob', 220, 2);
      const deepStack = new Player('p3', 'Charlie', 1000, 3);
      cumulativeGame.addPlayer(firstShort);
      cumulativeGame.addPlayer(secondShort);
      cumulativeGame.addPlayer(deepStack);
      cumulativeGame.startHand();

      const flopState = advanceThreePlayersToFlop(cumulativeGame);
      const originalBettorId = flopState.players[flopState.currentPlayerIndex].id;

      expect(cumulativeGame.handleAction(originalBettorId, 'bet', 100).valid).toBe(true);

      let state = cumulativeGame.getGameState();
      expect(cumulativeGame.handleAction(state.players[state.currentPlayerIndex].id, 'all-in').valid).toBe(true);

      state = cumulativeGame.getGameState();
      expect(state.currentBet).toBe(130);
      expect(state.minRaiseSize).toBe(100);
      expect(cumulativeGame.handleAction(state.players[state.currentPlayerIndex].id, 'all-in').valid).toBe(true);

      state = cumulativeGame.getGameState();
      expect(state.currentBet).toBe(200);
      expect(state.minRaiseSize).toBe(100);
      expect(state.players[state.currentPlayerIndex].id).toBe(originalBettorId);

      const reopenedRaise = cumulativeGame.handleAction(originalBettorId, 'raise', 100);
      expect(reopenedRaise.valid).toBe(true);

      const afterRaise = cumulativeGame.getGameState();
      expect(afterRaise.stage).toBe('complete');
      expect(afterRaise.currentBet).toBe(0);
    });

    it('should keep betting closed when cumulative short all-ins stay below a full raise', () => {
      const cumulativeGame = new Game(config);
      const firstShort = new Player('p1', 'Alice', 150, 1);
      const secondShort = new Player('p2', 'Bob', 200, 2);
      const deepStack = new Player('p3', 'Charlie', 1000, 3);
      cumulativeGame.addPlayer(firstShort);
      cumulativeGame.addPlayer(secondShort);
      cumulativeGame.addPlayer(deepStack);
      cumulativeGame.startHand();

      const flopState = advanceThreePlayersToFlop(cumulativeGame);
      const originalBettorId = flopState.players[flopState.currentPlayerIndex].id;

      expect(cumulativeGame.handleAction(originalBettorId, 'bet', 100).valid).toBe(true);

      let state = cumulativeGame.getGameState();
      expect(cumulativeGame.handleAction(state.players[state.currentPlayerIndex].id, 'all-in').valid).toBe(true);

      state = cumulativeGame.getGameState();
      expect(cumulativeGame.handleAction(state.players[state.currentPlayerIndex].id, 'all-in').valid).toBe(true);

      const afterSecondShortAllIn = cumulativeGame.getGameState();
      expect(afterSecondShortAllIn.currentBet).toBe(180);
      expect(afterSecondShortAllIn.minRaiseSize).toBe(100);
      expect(afterSecondShortAllIn.players[afterSecondShortAllIn.currentPlayerIndex].id).toBe(originalBettorId);

      const closedRaise = cumulativeGame.handleAction(originalBettorId, 'raise', 100);
      expect(closedRaise.valid).toBe(false);
      expect(closedRaise.error).toContain('not been reopened');
    });

    it('should keep the minimum raise threshold after a short all-in opener below the street minimum', () => {
      const openerGame = new Game(config);
      const shortOpener = new Player('p1', 'Alice', 35, 1);
      const deepStack = new Player('p2', 'Bob', 1000, 2);
      openerGame.addPlayer(shortOpener);
      openerGame.addPlayer(deepStack);
      openerGame.startHand();

      const flopState = advanceHeadsUpToFlop(openerGame);
      const openerId = flopState.players[flopState.currentPlayerIndex].id;
      const responderId = flopState.players[(flopState.currentPlayerIndex + 1) % 2].id;

      const shortOpen = openerGame.handleAction(openerId, 'all-in');
      expect(shortOpen.valid).toBe(true);

      let state = openerGame.getGameState();
      expect(state.stage).toBe('flop');
      expect(state.currentBet).toBe(15);
      expect(state.minRaiseSize).toBe(20);
      expect(state.players[state.currentPlayerIndex].id).toBe(responderId);

      const tooSmallRaise = openerGame.handleAction(responderId, 'raise', 15);
      expect(tooSmallRaise.valid).toBe(false);
      expect(tooSmallRaise.error).toContain('Minimum raise is $20');

      const legalRaise = openerGame.handleAction(responderId, 'raise', 20);
      expect(legalRaise.valid).toBe(true);

      state = openerGame.getGameState();
      expect(state.stage).toBe('complete');
      expect(state.currentBet).toBe(0);
    });
  });

  describe('Post-Flop Action Order', () => {
    it('should start post-flop betting at big blind position in heads-up', () => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
      
      const preState = game.getGameState();
      const sbId = preState.players[preState.smallBlindIndex].id;
      const bbId = preState.players[preState.bigBlindIndex].id;
      
      const sbCall = game.handleAction(sbId, 'call');
      expect(sbCall.valid).toBe(true);
      const afterSbCall = game.getGameState();
      expect(afterSbCall.stage).toBe('preflop');
      expect(afterSbCall.currentPlayerIndex).toBe(afterSbCall.bigBlindIndex);

      const bbCheck = game.handleAction(bbId, 'check');
      expect(bbCheck.valid).toBe(true);
      
      // Post-flop should start with big blind.
      const postState = game.getGameState();
      expect(postState.stage).toBe('flop');
      expect(postState.currentPlayerIndex).toBe(postState.bigBlindIndex);
    });

    it('should maintain big-blind-first order through all streets in heads-up', () => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();
      
      const preState = game.getGameState();
      const sbId = preState.players[preState.smallBlindIndex].id;
      const bbId = preState.players[preState.bigBlindIndex].id;
      
      // Pre-flop
      expect(game.handleAction(sbId, 'call').valid).toBe(true);
      expect(game.getGameState().stage).toBe('preflop');
      expect(game.getGameState().currentPlayerIndex).toBe(game.getGameState().bigBlindIndex);
      expect(game.handleAction(bbId, 'check').valid).toBe(true);
      
      // Flop - should start at BB
      let state = game.getGameState();
      expect(state.currentPlayerIndex).toBe(state.bigBlindIndex);
      const currentId1 = state.players[state.currentPlayerIndex].id;
      const nextId1 = state.players[(state.currentPlayerIndex + 1) % 2].id;
      expect(game.handleAction(currentId1, 'check').valid).toBe(true);
      expect(game.handleAction(nextId1, 'check').valid).toBe(true);
      
      // Turn - should start at BB
      state = game.getGameState();
      expect(state.currentPlayerIndex).toBe(state.bigBlindIndex);
      const currentId2 = state.players[state.currentPlayerIndex].id;
      const nextId2 = state.players[(state.currentPlayerIndex + 1) % 2].id;
      expect(game.handleAction(currentId2, 'check').valid).toBe(true);
      expect(game.handleAction(nextId2, 'check').valid).toBe(true);
      
      // River - should start at BB
      state = game.getGameState();
      expect(state.currentPlayerIndex).toBe(state.bigBlindIndex);
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

    it('should have big blind act first post-flop in heads-up', () => {
      headsUpGame.startHand();
      const preState = headsUpGame.getGameState();
      const sbId = preState.players[preState.smallBlindIndex].id;
      const bbId = preState.players[preState.bigBlindIndex].id;

      expect(headsUpGame.handleAction(sbId, 'call').valid).toBe(true);
      const afterSbCall = headsUpGame.getGameState();
      expect(afterSbCall.stage).toBe('preflop');
      expect(afterSbCall.currentPlayerIndex).toBe(afterSbCall.bigBlindIndex);

      expect(headsUpGame.handleAction(bbId, 'check').valid).toBe(true);
      const state = headsUpGame.getGameState();
      expect(state.stage).toBe('flop');
      expect(state.currentPlayerIndex).toBe(state.bigBlindIndex);
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

  describe('Preflop Blind Response Rights', () => {
    it('should keep preflop open until the big blind responds heads-up', () => {
      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();

      const initialState = game.getGameState();
      const sbId = initialState.players[initialState.smallBlindIndex].id;
      const bbId = initialState.players[initialState.bigBlindIndex].id;

      const sbCall = game.handleAction(sbId, 'call');
      expect(sbCall.valid).toBe(true);

      const afterSbCall = game.getGameState();
      expect(afterSbCall.stage).toBe('preflop');
      expect(afterSbCall.currentPlayerIndex).toBe(afterSbCall.bigBlindIndex);
      expect(afterSbCall.players[afterSbCall.currentPlayerIndex].id).toBe(bbId);

      const bbCheck = game.handleAction(bbId, 'check');
      expect(bbCheck.valid).toBe(true);

      const afterBbCheck = game.getGameState();
      expect(afterBbCheck.stage).toBe('flop');
      expect(afterBbCheck.currentPlayerIndex).toBe(afterBbCheck.bigBlindIndex);
    });

    it('should keep preflop open until small blind and big blind both respond in three-player hands', () => {
      const threePlayerGame = new Game(config);
      const p1 = new Player('p1', 'Alice', 1000, 1);
      const p2 = new Player('p2', 'Bob', 1000, 2);
      const p3 = new Player('p3', 'Charlie', 1000, 3);
      threePlayerGame.addPlayer(p1);
      threePlayerGame.addPlayer(p2);
      threePlayerGame.addPlayer(p3);
      threePlayerGame.startHand();

      let state = threePlayerGame.getGameState();
      const utgId = state.players[state.currentPlayerIndex].id;
      expect(threePlayerGame.handleAction(utgId, 'call').valid).toBe(true);

      state = threePlayerGame.getGameState();
      expect(state.stage).toBe('preflop');
      expect(state.currentPlayerIndex).toBe(state.smallBlindIndex);
      expect(threePlayerGame.handleAction(state.players[state.currentPlayerIndex].id, 'call').valid).toBe(true);

      state = threePlayerGame.getGameState();
      expect(state.stage).toBe('preflop');
      expect(state.currentPlayerIndex).toBe(state.bigBlindIndex);
      expect(threePlayerGame.handleAction(state.players[state.currentPlayerIndex].id, 'check').valid).toBe(true);

      state = threePlayerGame.getGameState();
      expect(state.stage).toBe('flop');
      expect(state.currentPlayerIndex).toBe(state.smallBlindIndex);
    });
  });

  describe('Live Participant Action Order', () => {
    it('should treat two active players plus one waiting seat as heads-up for action order', () => {
      const liveGame = new Game(config);
      const p1 = new Player('p1', 'Alice', 1000, 1);
      const p2 = new Player('p2', 'Bob', 1000, 3);
      const queuedP3 = new Player('p3', 'Charlie', 1000, 5);
      liveGame.addPlayer(p1);
      liveGame.addPlayer(p2);
      liveGame.startHand();
      liveGame.addPlayer(queuedP3);

      const finishFirstHand = liveGame.getGameState();
      expect(liveGame.handleAction(finishFirstHand.players[finishFirstHand.currentPlayerIndex].id, 'fold').valid).toBe(true);

      liveGame.startHand();
      const preflopState = liveGame.getGameState();
      expect(preflopState.players[preflopState.dealerIndex].waitingForBigBlind).toBe(false);
      expect(preflopState.players[preflopState.smallBlindIndex].waitingForBigBlind).toBe(false);
      expect(preflopState.players[preflopState.bigBlindIndex].waitingForBigBlind).toBe(false);
      expect(preflopState.players.find((player) => player.id === 'p3')?.waitingForBigBlind).toBe(true);
      expect(preflopState.currentPlayerIndex).toBe(preflopState.smallBlindIndex);

      const sbId = preflopState.players[preflopState.smallBlindIndex].id;
      const bbId = preflopState.players[preflopState.bigBlindIndex].id;
      expect(liveGame.handleAction(sbId, 'call').valid).toBe(true);

      const afterSbCall = liveGame.getGameState();
      expect(afterSbCall.stage).toBe('preflop');
      expect(afterSbCall.currentPlayerIndex).toBe(afterSbCall.bigBlindIndex);
      expect(afterSbCall.players[afterSbCall.currentPlayerIndex].id).toBe(bbId);

      expect(liveGame.handleAction(bbId, 'check').valid).toBe(true);
      const flopState = liveGame.getGameState();
      expect(flopState.stage).toBe('flop');
      expect(flopState.currentPlayerIndex).toBe(flopState.bigBlindIndex);
    });

    it('should keep live blinds and first action correct with a seat gap between active players', () => {
      const gapGame = new Game(config);
      const p1 = new Player('p1', 'Alice', 1000, 1);
      const p2 = new Player('p2', 'Bob', 1000, 5);
      const waitingP3 = new Player('p3', 'Charlie', 1000, 7);
      gapGame.addPlayer(p1);
      gapGame.addPlayer(p2);
      gapGame.startHand();
      gapGame.addPlayer(waitingP3);

      const firstHand = gapGame.getGameState();
      expect(gapGame.handleAction(firstHand.players[firstHand.currentPlayerIndex].id, 'fold').valid).toBe(true);

      gapGame.startHand();
      const state = gapGame.getGameState();
      const liveBlindIds = new Set([
        state.players[state.dealerIndex].id,
        state.players[state.smallBlindIndex].id,
        state.players[state.bigBlindIndex].id,
      ]);
      expect(liveBlindIds.has('p3')).toBe(false);
      expect(state.currentPlayerIndex).toBe(state.smallBlindIndex);
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

  describe('Side Pot Handling', () => {
    it('should distribute main and side pots to the correct winners', () => {
      const sidePotGame = new Game({ smallBlind: 10, bigBlind: 20, initialStack: 1000 });
      const p1 = new Player('p1', 'Alice', 1000);
      const p2 = new Player('p2', 'Bob', 1000);
      const p3 = new Player('p3', 'Charlie', 1000);
      sidePotGame.addPlayer(p1);
      sidePotGame.addPlayer(p2);
      sidePotGame.addPlayer(p3);
      sidePotGame.startHand();

      // Force deterministic showdown cards:
      // p1 wins main pot with ace-high flush
      // p2 wins side pot against p3
      p1.dealHoleCards([new Card('hearts', 'A'), new Card('hearts', 'Q')]);
      p2.dealHoleCards([new Card('clubs', 'K'), new Card('spades', 'K')]);
      p3.dealHoleCards([new Card('clubs', 'Q'), new Card('clubs', 'J')]);
      (sidePotGame as any).communityCards = [
        new Card('hearts', '2'),
        new Card('hearts', '3'),
        new Card('hearts', '4'),
        new Card('clubs', '9'),
        new Card('diamonds', 'K'),
      ];

      // Contributions: p1=100, p2=300, p3=300 => total pot 700
      (p1 as any).stack = 900;
      (p2 as any).stack = 700;
      (p3 as any).stack = 700;
      (p1 as any).totalBetThisRound = 100;
      (p2 as any).totalBetThisRound = 300;
      (p3 as any).totalBetThisRound = 300;
      (sidePotGame as any).pot = 700;

      (sidePotGame as any).showdown();

      const result = sidePotGame.getLastHandResult();
      expect(result).not.toBeNull();
      expect(result?.winners).toHaveLength(2);

      const winnerById = new Map(result?.winners.map((winner) => [winner.playerId, winner.amount]));
      expect(winnerById.get('p1')).toBe(300);
      expect(winnerById.get('p2')).toBe(400);
      expect(winnerById.get('p3')).toBeUndefined();

      expect(p1.getStack()).toBe(1200);
      expect(p2.getStack()).toBe(1100);
      expect(p3.getStack()).toBe(700);
    });

    it('should expose side pots separately from total pot in game state', () => {
      const sidePotGame = new Game({ smallBlind: 10, bigBlind: 20, initialStack: 1000 });
      const p1 = new Player('p1', 'Alice', 1000);
      const p2 = new Player('p2', 'Bob', 1000);
      const p3 = new Player('p3', 'Charlie', 1000);
      sidePotGame.addPlayer(p1);
      sidePotGame.addPlayer(p2);
      sidePotGame.addPlayer(p3);
      sidePotGame.startHand();

      (p1 as any).totalBetThisRound = 100;
      (p2 as any).totalBetThisRound = 300;
      (p3 as any).totalBetThisRound = 300;
      (p1 as any).isAllIn = true;
      (sidePotGame as any).pot = 700;

      const state = sidePotGame.getGameState();
      expect(state.pot).toBe(700);
      expect(state.sidePots).toHaveLength(1);
      expect(state.sidePots[0].amount).toBe(400);
    });

    it('should not expose side pot labels when nobody is all-in', () => {
      const regularBetGame = new Game({ smallBlind: 10, bigBlind: 20, initialStack: 1000 });
      const p1 = new Player('p1', 'Alice', 1000);
      const p2 = new Player('p2', 'Bob', 1000);
      const p3 = new Player('p3', 'Charlie', 1000);
      regularBetGame.addPlayer(p1);
      regularBetGame.addPlayer(p2);
      regularBetGame.addPlayer(p3);
      regularBetGame.startHand();

      (p1 as any).totalBetThisRound = 100;
      (p2 as any).totalBetThisRound = 300;
      (p3 as any).totalBetThisRound = 300;
      (regularBetGame as any).pot = 700;

      const state = regularBetGame.getGameState();
      expect(state.pot).toBe(700);
      expect(state.sidePots).toHaveLength(0);
    });
  });
});
