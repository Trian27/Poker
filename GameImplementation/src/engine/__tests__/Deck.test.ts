import { Deck } from '../Deck';

describe('Deck', () => {
  let deck: Deck;

  beforeEach(() => {
    deck = new Deck();
  });

  describe('constructor', () => {
    it('should create a deck with 52 cards', () => {
      expect(deck.remaining()).toBe(52);
    });
  });

  describe('reset', () => {
    it('should reset deck to 52 cards', () => {
      deck.deal();
      deck.deal();
      expect(deck.remaining()).toBe(50);
      
      deck.reset();
      expect(deck.remaining()).toBe(52);
    });

    it('should contain all 52 unique cards', () => {
      const cards = deck.dealMultiple(52);
      const cardStrings = cards.map(c => c.toShortString());
      const uniqueCards = new Set(cardStrings);
      expect(uniqueCards.size).toBe(52);
    });
  });

  describe('shuffle', () => {
    it('should randomize card order', () => {
      // Deal all cards in order
      const originalOrder = deck.dealMultiple(52).map(c => c.toShortString());
      
      // Reset and shuffle, then deal again
      deck.reset();
      deck.shuffle();
      const shuffledOrder = deck.dealMultiple(52).map(c => c.toShortString());
      
      // They should not be in the same order (statistically almost impossible)
      expect(originalOrder).not.toEqual(shuffledOrder);
    });
  });

  describe('deal', () => {
    it('should deal a single card', () => {
      const card = deck.deal();
      expect(card).toBeDefined();
      expect(deck.remaining()).toBe(51);
    });

    it('should throw error when dealing from empty deck', () => {
      deck.dealMultiple(52);
      expect(() => deck.deal()).toThrow('Cannot deal from an empty deck');
    });
  });

  describe('dealMultiple', () => {
    it('should deal multiple cards', () => {
      const cards = deck.dealMultiple(5);
      expect(cards).toHaveLength(5);
      expect(deck.remaining()).toBe(47);
    });

    it('should throw error when dealing more cards than remaining', () => {
      expect(() => deck.dealMultiple(53)).toThrow();
    });
  });
});
