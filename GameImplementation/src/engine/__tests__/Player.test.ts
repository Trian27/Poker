import { Player } from '../Player';
import { Card } from '../Card';

describe('Player', () => {
  let player: Player;

  beforeEach(() => {
    player = new Player('player1', 'Alice', 1000);
  });

  describe('constructor', () => {
    it('should create player with correct properties', () => {
      expect(player.id).toBe('player1');
      expect(player.name).toBe('Alice');
      expect(player.getStack()).toBe(1000);
    });
  });

  describe('dealHoleCards', () => {
    it('should deal exactly 2 hole cards', () => {
      const cards = [new Card('hearts', 'A'), new Card('spades', 'K')];
      player.dealHoleCards(cards);
      expect(player.getHoleCards()).toHaveLength(2);
    });

    it('should throw error if not exactly 2 cards', () => {
      const cards = [new Card('hearts', 'A')];
      expect(() => player.dealHoleCards(cards)).toThrow('Player must receive exactly 2 hole cards');
    });
  });

  describe('bet', () => {
    it('should deduct bet from stack', () => {
      player.bet(100);
      expect(player.getStack()).toBe(900);
      expect(player.getCurrentBet()).toBe(100);
    });

    it('should handle all-in when bet exceeds stack', () => {
      const betAmount = player.bet(1500);
      expect(betAmount).toBe(1000);
      expect(player.getStack()).toBe(0);
      expect(player.getIsAllIn()).toBe(true);
    });

    it('should accumulate bets in current round', () => {
      player.bet(100);
      player.bet(200);
      expect(player.getCurrentBet()).toBe(300);
      expect(player.getTotalBetThisRound()).toBe(300);
    });

    it('should throw error for negative bet', () => {
      expect(() => player.bet(-50)).toThrow('Bet amount cannot be negative');
    });
  });

  describe('fold', () => {
    it('should mark player as folded and inactive', () => {
      player.fold();
      expect(player.getHasFolded()).toBe(true);
      expect(player.getIsActive()).toBe(false);
    });
  });

  describe('resetForNewRound', () => {
    it('should reset current bet but keep total bet', () => {
      player.bet(100);
      player.resetForNewRound();
      expect(player.getCurrentBet()).toBe(0);
      expect(player.getTotalBetThisRound()).toBe(100);
    });
  });

  describe('resetForNewHand', () => {
    it('should reset all betting state', () => {
      player.dealHoleCards([new Card('hearts', 'A'), new Card('spades', 'K')]);
      player.bet(100);
      player.fold();
      
      player.resetForNewHand();
      
      expect(player.getCurrentBet()).toBe(0);
      expect(player.getTotalBetThisRound()).toBe(0);
      expect(player.getHoleCards()).toHaveLength(0);
      expect(player.getHasFolded()).toBe(false);
      expect(player.getIsAllIn()).toBe(false);
      expect(player.getIsActive()).toBe(true);
    });

    it('should mark player as inactive if stack is zero', () => {
      player.bet(1000); // All-in
      player.resetForNewHand();
      expect(player.getIsActive()).toBe(false);
    });
  });

  describe('addChips', () => {
    it('should add chips to stack', () => {
      player.addChips(500);
      expect(player.getStack()).toBe(1500);
    });
  });

  describe('getState', () => {
    it('should return complete player state', () => {
      const cards = [new Card('hearts', 'A'), new Card('spades', 'K')];
      player.dealHoleCards(cards);
      player.bet(100);
      
      const state = player.getState();
      
      expect(state.id).toBe('player1');
      expect(state.name).toBe('Alice');
      expect(state.stack).toBe(900);
      expect(state.currentBet).toBe(100);
      expect(state.holeCards).toHaveLength(2);
      expect(state.hasFolded).toBe(false);
      expect(state.isAllIn).toBe(false);
      expect(state.isActive).toBe(true);
    });
  });

  describe('getPublicState', () => {
    it('should return state without revealing hole cards', () => {
      const cards = [new Card('hearts', 'A'), new Card('spades', 'K')];
      player.dealHoleCards(cards);
      
      const publicState = player.getPublicState();
      
      expect(publicState.holeCards).toBe(2); // Just the count
      expect(publicState.id).toBe('player1');
      expect(publicState.name).toBe('Alice');
    });
  });
});
