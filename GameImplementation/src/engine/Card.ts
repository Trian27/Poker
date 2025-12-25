/**
 * Represents a playing card with a suit and rank
 */
export class Card {
  readonly suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  readonly rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

  constructor(suit: Card['suit'], rank: Card['rank']) {
    this.suit = suit;
    this.rank = rank;
  }

  /**
   * Returns the numeric value of the card for comparison (2-14, where Ace = 14)
   */
  getValue(): number {
    const values: Record<Card['rank'], number> = {
      '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
      'J': 11, 'Q': 12, 'K': 13, 'A': 14
    };
    return values[this.rank];
  }

  /**
   * Returns a string representation of the card (e.g., "A♠")
   */
  toString(): string {
    const suitSymbols = {
      hearts: '♥',
      diamonds: '♦',
      clubs: '♣',
      spades: '♠'
    };
    return `${this.rank}${suitSymbols[this.suit]}`;
  }

  /**
   * Returns a simple string representation (e.g., "AS" for Ace of Spades)
   */
  toShortString(): string {
    const suitShort = {
      hearts: 'H',
      diamonds: 'D',
      clubs: 'C',
      spades: 'S'
    };
    return `${this.rank}${suitShort[this.suit]}`;
  }
}
