/**
 * Type definitions for the poker platform
 */

export interface User {
  id: number;
  username: string;
  email: string;
  created_at: string;
  is_admin?: boolean;
  is_banned?: boolean;
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
  currency?: string;
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
  currency?: string;
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
  tournament_start_time?: string | null;
  tournament_starting_stack?: number;
  tournament_security_deposit?: number;
  tournament_confirmation_window_seconds?: number;
  tournament_confirmation_deadline?: string | null;
  tournament_blind_interval_minutes?: number;
  tournament_blind_progression_percent?: number;
  tournament_state?: 'scheduled' | 'waiting_for_players' | 'awaiting_confirmations' | 'running' | 'completed' | 'canceled' | null;
  tournament_payout?: number[] | null;
  tournament_payout_is_percentage?: boolean;
  tournament_prize_pool?: number;
  tournament_bracket?: Record<string, unknown> | null;
  tournament_started_at?: string | null;
  tournament_completed_at?: string | null;
  tournament_registration_count?: number;
  tournament_is_registered?: boolean;
}

export interface CreateTableRequest {
  name: string;
  game_type: 'cash' | 'tournament';
  max_seats: number;
  small_blind: number;
  big_blind: number;
  buy_in: number;
  agents_allowed?: boolean;
  tournament_start_time?: string;
  tournament_starting_stack?: number;
  tournament_security_deposit?: number;
  tournament_confirmation_window_seconds?: number;
  tournament_blind_interval_minutes?: number;
  tournament_blind_progression_percent?: number;
  tournament_payout?: number[];
  tournament_payout_is_percentage?: boolean;
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

export interface TournamentRegistrationEntry {
  table_id: number;
  user_id: number;
  username: string;
  paid_entry_fee: number;
  paid_security_deposit: number;
  starting_stack: number;
  status: string;
  confirmed_at?: string | null;
  registered_at: string;
}

export interface TableTournamentDetails {
  table_id: number;
  table_name: string;
  state: 'scheduled' | 'waiting_for_players' | 'awaiting_confirmations' | 'running' | 'completed' | 'canceled';
  start_time?: string | null;
  started_at?: string | null;
  confirmation_deadline?: string | null;
  buy_in: number;
  security_deposit: number;
  starting_stack: number;
  blind_interval_minutes: number;
  blind_progression_percent: number;
  confirmation_window_seconds: number;
  max_players: number;
  registration_count: number;
  prize_pool: number;
  payout: number[];
  payout_is_percentage: boolean;
  bracket?: Record<string, unknown> | null;
  can_set_payout: boolean;
  is_registered: boolean;
  is_confirmed: boolean;
  registrations: TournamentRegistrationEntry[];
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
  seatNumber?: number;
  profileImageUrl?: string | null;
  timeBankMs?: number;
  timeBankSeconds?: number;
  hand?: Card[];
  hasFolded: boolean;
  isAllIn: boolean;
  isApiBot?: boolean;
  waitingForBigBlind?: boolean;
  position?: string;
}

export interface SidePot {
  index: number;
  amount: number;
  eligiblePlayerIds: number[];
}

export interface HandResultWinner {
  playerId: string;
  userId: number | null;
  username: string;
  amount: number;
  handDescription: string;
  bestHandCards: Card[];
  holeCards: Card[];
}

export interface HandResultPlayerCards {
  playerId: string;
  userId: number | null;
  username: string;
  folded: boolean;
  isWinner: boolean;
  holeCards: Card[];
}

export interface HandResult {
  totalPot: number;
  endedByFold: boolean;
  winners: HandResultWinner[];
  players: HandResultPlayerCards[];
}

export interface GameState {
  gameId: string;
  communityId: number;
  players: Player[];
  communityCards: Card[];
  pot: number;
  sidePots?: SidePot[];
  currentTurnPlayerId: number | null;
  phase: 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'finished';
  minBet: number;
  minRaiseSize?: number;
  dealerPosition: number;
  dealerPlayerId?: number | null;
  smallBlind: number;
  smallBlindPlayerId?: number | null;
  bigBlind: number;
  bigBlindPlayerId?: number | null;
  lastHandResult?: HandResult | null;
  actionTimeoutSeconds?: number;
  remainingActionTime?: number;
  remainingReserveTime?: number;
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

export interface HandHistorySummary {
  id: string;
  table_name: string;
  played_at: string;
  pot_size: number;
  winner_username?: string | null;
  player_count: number;
}

export interface HandHistoryResponse {
  id: string;
  community_id: number;
  table_id?: number | null;
  table_name: string;
  played_at: string;
  hand_data: Record<string, unknown>;
}

export interface LearningSessionSummary {
  id: number;
  table_id?: number | null;
  community_id: number;
  table_name: string;
  buy_in_amount: number;
  joined_at: string;
  left_at?: string | null;
  hand_count: number;
  last_hand_at?: string | null;
}

export interface LearningCoachAction {
  action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | string;
  amount?: number | null;
  score: number;
  rationale: string;
}

export interface LearningCoachRecommendation {
  recommended_action: string;
  summary: string;
  tags: string[];
  top_actions: LearningCoachAction[];
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

export interface SkinDesignSpec {
  format_version: number;
  renderer: string;
  asset_manifest: Record<string, string>;
  theme_tokens?: Record<string, unknown>;
  notes?: string;
}

export interface PlayerNote {
  target_user_id: number;
  target_username: string;
  notes: string;
  updated_at?: string | null;
}

export interface SkinCatalogItem {
  id: number;
  slug: string;
  name: string;
  description?: string | null;
  category: 'cards' | 'table' | 'avatar' | 'emote' | 'other';
  price_gold_coins: number;
  design_spec: Record<string, unknown>;
  preview_url?: string | null;
  is_active: boolean;
  created_by_user_id?: number | null;
  created_at: string;
}

export interface UserSkin {
  skin_id: number;
  is_equipped: boolean;
  acquired_at: string;
  skin: SkinCatalogItem;
}

export interface SkinSubmission {
  id: number;
  user_id: number;
  username: string;
  name: string;
  category: 'cards' | 'table' | 'avatar' | 'emote' | 'other';
  design_spec: Record<string, unknown>;
  desired_price_gold_coins: number;
  reference_image_url?: string | null;
  submitter_notes?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  workflow_state:
    | 'pending_admin_review'
    | 'admin_accepted_waiting_creator'
    | 'admin_declined'
    | 'creator_accepted_published'
    | 'creator_declined';
  review_notes?: string | null;
  admin_proposed_design_spec?: Record<string, unknown> | null;
  admin_rendered_image_url?: string | null;
  admin_proposed_price_gold_coins?: number | null;
  admin_comment?: string | null;
  creator_decision?: string | null;
  creator_comment?: string | null;
  creator_responded_at?: string | null;
  finalized_skin_id?: number | null;
  reviewed_by_user_id?: number | null;
  reviewed_at?: string | null;
  created_at: string;
}

export interface DirectConversation {
  user_id: number;
  username: string;
  last_message: string;
  last_message_at: string;
  unread_count: number;
}

export interface DirectMessage {
  id: number;
  sender_user_id: number;
  sender_username: string;
  recipient_user_id: number;
  recipient_username: string;
  content: string;
  created_at: string;
  read_at?: string | null;
}

export interface MarketplaceCoinPackage {
  package_key: string;
  gold_coins: number;
  usd_cents: number;
}

export interface CoinPurchaseIntent {
  id: number;
  provider: string;
  package_key: string;
  gold_coins: number;
  usd_cents: number;
  status: string;
  provider_reference?: string | null;
  checkout_url?: string | null;
  created_at: string;
}

export interface CreatorEarnings {
  pending_cents: number;
  paid_cents: number;
  total_cents: number;
  payout_email?: string | null;
}

export interface CreatorPayoutRequest {
  id: number;
  amount_cents: number;
  payout_email: string;
  status: 'pending' | 'paid' | 'rejected' | string;
  processor_note?: string | null;
  payout_reference?: string | null;
  processed_by_user_id?: number | null;
  requested_at: string;
  processed_at?: string | null;
}

export interface Tournament {
  id: number;
  name: string;
  description?: string | null;
  gold_prize_pool: number;
  starts_at?: string | null;
  ends_at?: string | null;
  status: 'draft' | 'announced' | 'running' | 'completed' | 'canceled';
  created_by_user_id: number;
  created_at: string;
}

export interface FeedbackReport {
  id: number;
  feedback_type: 'bug' | 'feedback';
  title: string;
  description: string;
  chief_complaint: string;
  status: string;
  created_at: string;
}

export interface FeedbackComplaintBucket {
  chief_complaint: string;
  count: number;
}
