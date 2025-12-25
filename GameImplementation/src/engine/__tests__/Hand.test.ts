import { Card } from '../Card';
import { HandEvaluator, HandRank } from '../Hand';

describe('HandEvaluator', () => {
  const createCards = (cardStrings: string[]): Card[] => {
    return cardStrings.map(str => {
      const rank = str.slice(0, -1) as Card['rank'];
      const suitMap: Record<string, Card['suit']> = {
        'H': 'hearts',
        'D': 'diamonds',
        'C': 'clubs',
        'S': 'spades'
      };
      const suit = suitMap[str.slice(-1)];
      return new Card(suit, rank);
    });
  };

  describe('evaluateHand', () => {
    it('should throw error with less than 5 cards', () => {
      const cards = createCards(['AH', 'KH', 'QH']);
      expect(() => HandEvaluator.evaluateHand(cards)).toThrow('Need at least 5 cards');
    });

    it('should identify Royal Flush', () => {
      const cards = createCards(['AH', 'KH', 'QH', 'JH', '10H', '2C', '3D']);
      const result = HandEvaluator.evaluateHand(cards);
      expect(result.rank).toBe(HandRank.ROYAL_FLUSH);
      expect(result.rankName).toBe('Royal Flush');
    });

    it('should identify Straight Flush', () => {
      const cards = createCards(['9H', '8H', '7H', '6H', '5H', '2C', 'AD']);
      const result = HandEvaluator.evaluateHand(cards);
      expect(result.rank).toBe(HandRank.STRAIGHT_FLUSH);
      expect(result.rankName).toBe('Straight Flush');
    });

    it('should identify Four of a Kind', () => {
      const cards = createCards(['KH', 'KC', 'KD', 'KS', '5H', '2C', '3D']);
      const result = HandEvaluator.evaluateHand(cards);
      expect(result.rank).toBe(HandRank.FOUR_OF_A_KIND);
      expect(result.rankName).toBe('Four of a Kind');
    });

    it('should identify Full House', () => {
      const cards = createCards(['KH', 'KC', 'KD', '5S', '5H', '2C', '3D']);
      const result = HandEvaluator.evaluateHand(cards);
      expect(result.rank).toBe(HandRank.FULL_HOUSE);
      expect(result.rankName).toBe('Full House');
    });

    it('should identify Flush', () => {
      const cards = createCards(['AH', 'JH', '9H', '6H', '3H', '2C', 'KD']);
      const result = HandEvaluator.evaluateHand(cards);
      expect(result.rank).toBe(HandRank.FLUSH);
      expect(result.rankName).toBe('Flush');
    });

    it('should identify Straight', () => {
      const cards = createCards(['9H', '8C', '7D', '6S', '5H', '2C', 'AD']);
      const result = HandEvaluator.evaluateHand(cards);
      expect(result.rank).toBe(HandRank.STRAIGHT);
      expect(result.rankName).toBe('Straight');
    });

    it('should identify Wheel (A-2-3-4-5 straight)', () => {
      const cards = createCards(['AH', '2C', '3D', '4S', '5H', 'KC', 'QD']);
      const result = HandEvaluator.evaluateHand(cards);
      expect(result.rank).toBe(HandRank.STRAIGHT);
    });

    it('should identify Three of a Kind', () => {
      const cards = createCards(['KH', 'KC', 'KD', '5S', '3H', '2C', 'AD']);
      const result = HandEvaluator.evaluateHand(cards);
      expect(result.rank).toBe(HandRank.THREE_OF_A_KIND);
      expect(result.rankName).toBe('Three of a Kind');
    });

    it('should identify Two Pair', () => {
      const cards = createCards(['KH', 'KC', '5D', '5S', '3H', '2C', 'AD']);
      const result = HandEvaluator.evaluateHand(cards);
      expect(result.rank).toBe(HandRank.TWO_PAIR);
      expect(result.rankName).toBe('Two Pair');
    });

    it('should identify One Pair', () => {
      const cards = createCards(['KH', 'KC', '5D', '8S', '3H', '2C', 'AD']);
      const result = HandEvaluator.evaluateHand(cards);
      expect(result.rank).toBe(HandRank.ONE_PAIR);
      expect(result.rankName).toBe('One Pair');
    });

    it('should identify High Card', () => {
      const cards = createCards(['AH', 'KC', '5D', '8S', '3H', '2C', '7D']);
      const result = HandEvaluator.evaluateHand(cards);
      expect(result.rank).toBe(HandRank.HIGH_CARD);
      expect(result.rankName).toBe('High Card');
    });
  });

  describe('compareHands', () => {
    it('should correctly compare hands of different ranks', () => {
      const flush = createCards(['AH', 'JH', '9H', '6H', '3H']);
      const straight = createCards(['9H', '8C', '7D', '6S', '5H']);
      
      const flushEval = HandEvaluator.evaluateHand(flush);
      const straightEval = HandEvaluator.evaluateHand(straight);
      
      expect(HandEvaluator.compareHands(flushEval, straightEval)).toBeGreaterThan(0);
      expect(HandEvaluator.compareHands(straightEval, flushEval)).toBeLessThan(0);
    });

    it('should correctly compare hands of the same rank', () => {
      // Pair of Aces vs Pair of Kings
      const pairAces = createCards(['AH', 'AC', 'KD', 'QS', 'JH']);
      const pairKings = createCards(['KH', 'KC', 'AD', 'QS', 'JH']);
      
      const acesEval = HandEvaluator.evaluateHand(pairAces);
      const kingsEval = HandEvaluator.evaluateHand(pairKings);
      
      expect(HandEvaluator.compareHands(acesEval, kingsEval)).toBeGreaterThan(0);
    });

    it('should identify exact ties', () => {
      const hand1 = createCards(['AH', 'AC', 'KD', 'QS', 'JH']);
      const hand2 = createCards(['AS', 'AD', 'KC', 'QH', 'JS']);
      
      const eval1 = HandEvaluator.evaluateHand(hand1);
      const eval2 = HandEvaluator.evaluateHand(hand2);
      
      expect(HandEvaluator.compareHands(eval1, eval2)).toBe(0);
    });

    it('should use kickers for tie-breaking pairs', () => {
      // Pair of Aces with King kicker vs Pair of Aces with Queen kicker
      const hand1 = createCards(['AH', 'AC', 'KD', 'QS', 'JH']);
      const hand2 = createCards(['AS', 'AD', 'QC', 'JD', '10H']);
      
      const eval1 = HandEvaluator.evaluateHand(hand1);
      const eval2 = HandEvaluator.evaluateHand(hand2);
      
      expect(HandEvaluator.compareHands(eval1, eval2)).toBeGreaterThan(0);
    });
  });
});
