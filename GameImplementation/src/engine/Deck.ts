import { Card } from './Card';

/**
 * Represents a deck of 52 playing cards
 */
export class Deck {
  private cards: Card[] = [];

  constructor() {
    this.reset();
  }

  /**
   * Resets the deck to a full 52-card deck
   */
  reset(): void {
    this.cards = [];
    const suits: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
    const ranks: Card['rank'][] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

    for (const suit of suits) {
      for (const rank of ranks) {
        this.cards.push(new Card(suit, rank));
      }
    }
  }

  /**
   * Shuffles the deck using Fisher-Yates algorithm
   */
  shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  /**
   * Deals a single card from the top of the deck
   * @throws Error if deck is empty
   */
  deal(): Card {
    const card = this.cards.pop();
    if (!card) {
      throw new Error('Cannot deal from an empty deck');
    }
    return card;
  }

  /**
   * Deals multiple cards from the deck
   */
  dealMultiple(count: number): Card[] {
    const cards: Card[] = [];
    for (let i = 0; i < count; i++) {
      cards.push(this.deal());
    }
    return cards;
  }

  /**
   * Burns a card (removes it from play without revealing)
   */
  burn(): void {
    if (this.cards.length > 0) {
      this.cards.pop();
    }
  }

  /**
   * Returns the number of cards remaining in the deck
   */
  remaining(): number {
    return this.cards.length;
  }
}
