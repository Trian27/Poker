import { Card } from '../Card';

describe('Card', () => {
  describe('constructor', () => {
    it('should create a card with valid suit and rank', () => {
      const card = new Card('hearts', 'A');
      expect(card.suit).toBe('hearts');
      expect(card.rank).toBe('A');
    });
  });

  describe('getValue', () => {
    it('should return correct numeric values', () => {
      expect(new Card('hearts', '2').getValue()).toBe(2);
      expect(new Card('hearts', '10').getValue()).toBe(10);
      expect(new Card('hearts', 'J').getValue()).toBe(11);
      expect(new Card('hearts', 'Q').getValue()).toBe(12);
      expect(new Card('hearts', 'K').getValue()).toBe(13);
      expect(new Card('hearts', 'A').getValue()).toBe(14);
    });
  });

  describe('toString', () => {
    it('should return formatted card string with symbols', () => {
      expect(new Card('hearts', 'A').toString()).toBe('A♥');
      expect(new Card('diamonds', 'K').toString()).toBe('K♦');
      expect(new Card('clubs', 'Q').toString()).toBe('Q♣');
      expect(new Card('spades', 'J').toString()).toBe('J♠');
    });
  });

  describe('toShortString', () => {
    it('should return short format card string', () => {
      expect(new Card('hearts', 'A').toShortString()).toBe('AH');
      expect(new Card('diamonds', 'K').toShortString()).toBe('KD');
      expect(new Card('clubs', '10').toShortString()).toBe('10C');
      expect(new Card('spades', '2').toShortString()).toBe('2S');
    });
  });
});
