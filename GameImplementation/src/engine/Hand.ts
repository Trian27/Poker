import { Card } from './Card';

/**
 * Hand rankings from highest to lowest
 */
export enum HandRank {
  ROYAL_FLUSH = 10,
  STRAIGHT_FLUSH = 9,
  FOUR_OF_A_KIND = 8,
  FULL_HOUSE = 7,
  FLUSH = 6,
  STRAIGHT = 5,
  THREE_OF_A_KIND = 4,
  TWO_PAIR = 3,
  ONE_PAIR = 2,
  HIGH_CARD = 1
}

export interface HandEvaluation {
  rank: HandRank;
  rankName: string;
  cards: Card[];
  tiebreakers: number[]; // Used for comparing hands of the same rank
}

/**
 * Evaluates a poker hand from 7 cards (2 hole cards + 5 community cards)
 * Returns the best possible 5-card hand
 */
export class HandEvaluator {
  /**
   * Evaluates the best 5-card hand from the given cards
   */
  static evaluateHand(cards: Card[]): HandEvaluation {
    if (cards.length < 5) {
      throw new Error('Need at least 5 cards to evaluate a hand');
    }

    // Generate all possible 5-card combinations
    const combinations = this.getCombinations(cards, 5);
    let bestHand: HandEvaluation | null = null;

    for (const combo of combinations) {
      const evaluation = this.evaluate5Cards(combo);
      if (!bestHand || this.compareHands(evaluation, bestHand) > 0) {
        bestHand = evaluation;
      }
    }

    return bestHand!;
  }

  /**
   * Evaluates a specific 5-card hand
   */
  private static evaluate5Cards(cards: Card[]): HandEvaluation {
    const sorted = [...cards].sort((a, b) => b.getValue() - a.getValue());

    // Check for flush
    const isFlush = this.isFlush(sorted);
    const isStraight = this.isStraight(sorted);

    if (isFlush && isStraight) {
      const isRoyal = sorted[0].getValue() === 14; // Ace high
      return {
        rank: isRoyal ? HandRank.ROYAL_FLUSH : HandRank.STRAIGHT_FLUSH,
        rankName: isRoyal ? 'Royal Flush' : 'Straight Flush',
        cards: sorted,
        tiebreakers: [sorted[0].getValue()]
      };
    }

    const groups = this.groupByRank(sorted);
    const groupSizes = Object.values(groups).map(g => g.length).sort((a, b) => b - a);

    // Four of a kind
    if (groupSizes[0] === 4) {
      const quadKey = Object.keys(groups).find(k => groups[parseInt(k)].length === 4)!;
      const quadValue = parseInt(quadKey);
      const kicker = sorted.find(c => c.getValue() !== quadValue)!.getValue();
      return {
        rank: HandRank.FOUR_OF_A_KIND,
        rankName: 'Four of a Kind',
        cards: sorted,
        tiebreakers: [quadValue, kicker]
      };
    }

    // Full house
    if (groupSizes[0] === 3 && groupSizes[1] === 2) {
      const tripKey = Object.keys(groups).find(k => groups[parseInt(k)].length === 3)!;
      const tripValue = parseInt(tripKey);
      const pairKey = Object.keys(groups).find(k => groups[parseInt(k)].length === 2)!;
      const pairValue = parseInt(pairKey);
      return {
        rank: HandRank.FULL_HOUSE,
        rankName: 'Full House',
        cards: sorted,
        tiebreakers: [tripValue, pairValue]
      };
    }

    // Flush
    if (isFlush) {
      return {
        rank: HandRank.FLUSH,
        rankName: 'Flush',
        cards: sorted,
        tiebreakers: sorted.map(c => c.getValue())
      };
    }

    // Straight
    if (isStraight) {
      return {
        rank: HandRank.STRAIGHT,
        rankName: 'Straight',
        cards: sorted,
        tiebreakers: [sorted[0].getValue()]
      };
    }

    // Three of a kind
    if (groupSizes[0] === 3) {
      const tripKey = Object.keys(groups).find(k => groups[parseInt(k)].length === 3)!;
      const tripValue = parseInt(tripKey);
      const kickers = sorted.filter(c => c.getValue() !== tripValue).map(c => c.getValue());
      return {
        rank: HandRank.THREE_OF_A_KIND,
        rankName: 'Three of a Kind',
        cards: sorted,
        tiebreakers: [tripValue, ...kickers]
      };
    }

    // Two pair
    if (groupSizes[0] === 2 && groupSizes[1] === 2) {
      const pairs = Object.keys(groups).filter(k => groups[parseInt(k)].length === 2).map(k => parseInt(k)).sort((a, b) => b - a);
      const kicker = sorted.find(c => !pairs.includes(c.getValue()))!.getValue();
      return {
        rank: HandRank.TWO_PAIR,
        rankName: 'Two Pair',
        cards: sorted,
        tiebreakers: [pairs[0], pairs[1], kicker]
      };
    }

    // One pair
    if (groupSizes[0] === 2) {
      const pairKey = Object.keys(groups).find(k => groups[parseInt(k)].length === 2)!;
      const pairValue = parseInt(pairKey);
      const kickers = sorted.filter(c => c.getValue() !== pairValue).map(c => c.getValue());
      return {
        rank: HandRank.ONE_PAIR,
        rankName: 'One Pair',
        cards: sorted,
        tiebreakers: [pairValue, ...kickers]
      };
    }

    // High card
    return {
      rank: HandRank.HIGH_CARD,
      rankName: 'High Card',
      cards: sorted,
      tiebreakers: sorted.map(c => c.getValue())
    };
  }

  /**
   * Compares two hands. Returns positive if hand1 wins, negative if hand2 wins, 0 for tie
   */
  static compareHands(hand1: HandEvaluation, hand2: HandEvaluation): number {
    if (hand1.rank !== hand2.rank) {
      return hand1.rank - hand2.rank;
    }

    // Same rank, compare tiebreakers
    for (let i = 0; i < Math.max(hand1.tiebreakers.length, hand2.tiebreakers.length); i++) {
      const tb1 = hand1.tiebreakers[i] || 0;
      const tb2 = hand2.tiebreakers[i] || 0;
      if (tb1 !== tb2) {
        return tb1 - tb2;
      }
    }

    return 0; // Exact tie
  }

  private static isFlush(cards: Card[]): boolean {
    return cards.every(card => card.suit === cards[0].suit);
  }

  private static isStraight(cards: Card[]): boolean {
    const values = cards.map(c => c.getValue()).sort((a, b) => b - a);
    
    // Check for regular straight
    let isRegularStraight = true;
    for (let i = 0; i < values.length - 1; i++) {
      if (values[i] - values[i + 1] !== 1) {
        isRegularStraight = false;
        break;
      }
    }

    // Check for A-2-3-4-5 (wheel)
    const isWheel = values[0] === 14 && values[1] === 5 && values[2] === 4 && values[3] === 3 && values[4] === 2;

    return isRegularStraight || isWheel;
  }

  private static groupByRank(cards: Card[]): Record<number, Card[]> {
    const groups: Record<number, Card[]> = {};
    for (const card of cards) {
      const value = card.getValue();
      if (!groups[value]) {
        groups[value] = [];
      }
      groups[value].push(card);
    }
    return groups;
  }

  private static getCombinations(arr: Card[], size: number): Card[][] {
    if (size > arr.length) return [];
    if (size === arr.length) return [arr];
    if (size === 1) return arr.map(card => [card]);

    const combinations: Card[][] = [];
    for (let i = 0; i <= arr.length - size; i++) {
      const head = arr[i];
      const tailCombinations = this.getCombinations(arr.slice(i + 1), size - 1);
      for (const tail of tailCombinations) {
        combinations.push([head, ...tail]);
      }
    }
    return combinations;
  }
}
