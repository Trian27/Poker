import { Card } from './Card';

export type PlayerAction = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';

export interface PlayerState {
  id: string;
  name: string;
  stack: number;
  currentBet: number;
  totalBetThisRound: number;
  holeCards: Card[];
  hasFolded: boolean;
  isAllIn: boolean;
  isActive: boolean; // Still in the hand
  seatNumber?: number; // Position at the table
}

/**
 * Represents a player in the poker game
 */
export class Player {
  readonly id: string;
  readonly name: string;
  readonly seatNumber?: number; // Position at the table (1-N)
  private stack: number;
  private currentBet: number = 0;
  private totalBetThisRound: number = 0;
  private holeCards: Card[] = [];
  private hasFolded: boolean = false;
  private isAllIn: boolean = false;
  private isActive: boolean = true;

  constructor(id: string, name: string, initialStack: number, seatNumber?: number) {
    this.id = id;
    this.name = name;
    this.stack = initialStack;
    this.seatNumber = seatNumber;
  }

  /**
   * Deals hole cards to the player
   */
  dealHoleCards(cards: Card[]): void {
    if (cards.length !== 2) {
      throw new Error('Player must receive exactly 2 hole cards');
    }
    this.holeCards = cards;
  }

  /**
   * Gets the player's hole cards (only visible to the player themselves)
   */
  getHoleCards(): Card[] {
    return [...this.holeCards];
  }

  /**
   * Places a bet
   */
  bet(amount: number): number {
    if (amount < 0) {
      throw new Error('Bet amount cannot be negative');
    }
    if (amount >= this.stack) {
      // All-in (when betting entire stack or more)
      const allInAmount = this.stack;
      this.currentBet += allInAmount;
      this.totalBetThisRound += allInAmount;
      this.stack = 0;
      this.isAllIn = true;
      return allInAmount;
    }

    this.stack -= amount;
    this.currentBet += amount;
    this.totalBetThisRound += amount;
    return amount;
  }

  /**
   * Folds the hand
   */
  fold(): void {
    this.hasFolded = true;
    this.isActive = false;
  }

  /**
   * Resets the player for a new betting round (but not a new hand)
   */
  resetForNewRound(): void {
    this.currentBet = 0;
    // Note: totalBetThisRound persists across betting rounds within the same hand
  }

  /**
   * Resets the player for a completely new hand
   */
  resetForNewHand(): void {
    this.currentBet = 0;
    this.totalBetThisRound = 0;
    this.holeCards = [];
    this.hasFolded = false;
    this.isAllIn = false;
    this.isActive = this.stack > 0; // Only active if they have chips
  }

  /**
   * Adds chips to the player's stack (e.g., winning a pot)
   */
  addChips(amount: number): void {
    this.stack += amount;
  }

  /**
   * Gets the current state of the player
   */
  getState(): PlayerState {
    return {
      id: this.id,
      name: this.name,
      stack: this.stack,
      currentBet: this.currentBet,
      totalBetThisRound: this.totalBetThisRound,
      holeCards: this.holeCards,
      hasFolded: this.hasFolded,
      isAllIn: this.isAllIn,
      isActive: this.isActive,
      seatNumber: this.seatNumber
    };
  }

  /**
   * Gets public state (without hole cards)
   */
  getPublicState(): Omit<PlayerState, 'holeCards'> & { holeCards: number } {
    const state = this.getState();
    return {
      ...state,
      holeCards: state.holeCards.length
    };
  }

  getStack(): number {
    return this.stack;
  }

  getCurrentBet(): number {
    return this.currentBet;
  }

  getTotalBetThisRound(): number {
    return this.totalBetThisRound;
  }

  getHasFolded(): boolean {
    return this.hasFolded;
  }

  getIsAllIn(): boolean {
    return this.isAllIn;
  }

  getIsActive(): boolean {
    return this.isActive;
  }

  /**
   * Sets the player as inactive (e.g., when sitting out)
   */
  setInactive(): void {
    this.isActive = false;
  }

  /**
   * Sets the player as active (e.g., when ready to play)
   */
  setActive(): void {
    this.isActive = true;
  }
}
