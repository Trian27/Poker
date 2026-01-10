/**
 * Type definitions for the poker platform
 */

export interface User {
  id: number;
  username: string;
  email: string;
  created_at: string;
  is_admin?: boolean;
}

export interface AdminUser {
  id: number;
  username: string;
  email: string;
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
  is_member?: boolean | null;
  has_pending_request?: boolean | null;
}

export interface Community {
  id: number;
  name: string;
  description: string;
  league_id: number;
  starting_balance: number | string;
  commissioner_id?: number | null;
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
  is_permanent?: boolean;
  created_by_user_id?: number;
  max_queue_size?: number;
  action_timeout_seconds?: number;
  agents_allowed?: boolean;
}

export interface CreateTableRequest {
  name: string;
  game_type: 'cash' | 'tournament';
  max_seats: number;
  small_blind: number;
  big_blind: number;
  buy_in: number;
  agents_allowed?: boolean;
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

// Join Request types
export interface JoinRequest {
  id: number;
  user_id: number;
  username: string;
  community_id: number;
  community_name: string;
  message: string | null;
  status: 'pending' | 'approved' | 'denied';
  custom_starting_balance: number | null;
  reviewed_by_user_id: number | null;
  reviewed_at: string | null;
  created_at: string;
}

// Inbox Message types
export interface InboxMessage {
  id: number;
  sender_username: string | null;
  message_type: string;
  title: string;
  content: string;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  is_actionable: boolean;
  action_taken: string | null;
  created_at: string;
  read_at: string | null;
}

export interface AdminList {
  owner?: AdminUser | null;
  commissioner?: AdminUser | null;
  admins: AdminUser[];
}
