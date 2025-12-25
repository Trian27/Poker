/**
 * Type definitions for the poker platform
 */

export interface User {
  id: number;
  username: string;
  email: string;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
}

export interface League {
  id: number;
  name: string;
  description: string;
  owner_id: number;
  created_at: string;
}

export interface Community {
  id: number;
  name: string;
  description: string;
  league_id: number;
  starting_balance: number | string;
  created_at: string;
}

export interface Wallet {
  id: number;
  user_id: number;
  community_id: number;
  balance: number | string;
  created_at: string;
}

export interface Table {
  id: number;
  community_id: number;
  name: string;
  status: 'waiting' | 'playing' | 'finished';
  game_type: 'cash' | 'tournament';
  max_seats: number;
  small_blind: number;
  big_blind: number;
  buy_in: number;
  created_at: string;
}

export interface CreateTableRequest {
  name: string;
  game_type: 'cash' | 'tournament';
  max_seats: number;
  small_blind: number;
  big_blind: number;
  buy_in: number;
}

export interface JoinTableRequest {
  buy_in_amount: number;
  seat_number: number;
}

export interface JoinTableResponse {
  success: boolean;
  message: string;
  new_balance: number;
  table_id: number;
}

export interface TableSeat {
  id: number;
  seat_number: number;
  user_id: number | null;
  username: string | null;
  occupied_at: string | null;
}

// Game-related types (for Socket.IO communication)
export interface Card {
  suit: string;
  rank: string;
}

export interface Player {
  id: number;
  username: string;
  stack: number;
  currentBet: number;
  hand?: Card[];
  hasFolded: boolean;
  isAllIn: boolean;
  position?: string;
}

export interface GameState {
  gameId: string;
  communityId: number;
  players: Player[];
  communityCards: Card[];
  pot: number;
  currentTurnPlayerId: number | null;
  phase: 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'finished';
  minBet: number;
  dealerPosition: number;
  smallBlind: number;
  bigBlind: number;
  actionTimeoutSeconds?: number;
  remainingActionTime?: number;
}

export interface GameAction {
  action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';
  amount?: number;
}

export interface ChatMessage {
  id: string;
  userId: number;
  username: string;
  message: string;
  timestamp: number;
  gameId?: string;
}
