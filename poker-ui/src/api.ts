/**
 * API Client for communicating with FastAPI backend
 */
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const TOKEN_STORAGE_KEY = 'token';
const USER_STORAGE_KEY = 'user';
let inMemoryToken: string | null = null;

const readPersistentToken = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
};

export const setApiAuthToken = (token: string | null) => {
  inMemoryToken = token;
};

export const getApiAuthToken = (): string | null => {
  return inMemoryToken ?? readPersistentToken();
};

export const clearApiAuthStorage = () => {
  inMemoryToken = null;
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(USER_STORAGE_KEY);
};

// Create axios instance with default config
export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to attach JWT token
api.interceptors.request.use(
  (config) => {
    const token = getApiAuthToken();
    if (token) {
      config.params = {
        ...config.params,
        token, // FastAPI expects token as query param
      };
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = String(error.config?.url || '');
    const skipAutoRedirect = (
      requestUrl.startsWith('/auth/login')
      || requestUrl.startsWith('/auth/verify-admin-login')
      || requestUrl.startsWith('/auth/recovery/request')
      || requestUrl.startsWith('/auth/recovery/verify')
    );

    if (error.response?.status === 401) {
      // Unauthorized - clear token and redirect to login (unless this endpoint handles 401 itself).
      if (!skipAutoRedirect) {
        clearApiAuthStorage();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth API calls
export const authApi = {
  register: async (username: string, email: string, password: string) => {
    const response = await api.post('/auth/register', {
      username,
      email,
      password,
    });
    return response.data;
  },

  login: async (username: string, password: string) => {
    const response = await api.post('/auth/login', null, {
      params: { username, password },
    });
    return response.data;
  },

  verifyEmail: async (email: string, verificationCode: string) => {
    const response = await api.post('/auth/verify-email', null, {
      params: { email, verification_code: verificationCode },
    });
    return response.data;
  },

  resendVerification: async (email: string) => {
    const response = await api.post('/auth/resend-verification', null, {
      params: { email },
    });
    return response.data;
  },

  verifyAdminLogin: async (email: string, verificationCode: string) => {
    const response = await api.post('/auth/verify-admin-login', null, {
      params: { email, verification_code: verificationCode },
    });
    return response.data;
  },

  requestAccountRecovery: async (email: string) => {
    const response = await api.post('/auth/recovery/request', { email });
    return response.data;
  },

  verifyAccountRecovery: async (email: string, verificationCode: string, newPassword?: string) => {
    const response = await api.post('/auth/recovery/verify', {
      email,
      verification_code: verificationCode,
      new_password: newPassword,
    });
    return response.data;
  },

  getCurrentUser: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  },
};

// Profile API
export const profileApi = {
  getProfile: async () => {
    const response = await api.get('/api/profile');
    return response.data;
  },

  requestUpdate: async (currentPassword: string, newUsername?: string, newEmail?: string, newPassword?: string) => {
    const response = await api.post('/api/profile/request-update', {
      current_password: currentPassword,
      new_username: newUsername,
      new_email: newEmail,
      new_password: newPassword,
    });
    return response.data;
  },

  verifyUpdate: async (verificationCode: string) => {
    const response = await api.post('/api/profile/verify-update', {
      verification_code: verificationCode,
    });
    return response.data;
  },
};

// Communities API
export const communitiesApi = {
  getAll: async () => {
    const response = await api.get('/api/communities');
    return response.data;
  },

  create: async (leagueId: number, name: string, description: string, startingBalance: number) => {
    const response = await api.post(`/api/leagues/${leagueId}/communities`, {
      name,
      description,
      starting_balance: startingBalance,
    });
    return response.data;
  },

  join: async (communityId: number) => {
    const response = await api.post(`/api/communities/${communityId}/join`);
    return response.data;
  },

  requestToJoin: async (communityId: number, message?: string) => {
    const response = await api.post(`/api/communities/${communityId}/request-join`, null, {
      params: { message },
    });
    return response.data;
  },

  getAdmins: async (communityId: number) => {
    const response = await api.get(`/api/communities/${communityId}/admins`);
    return response.data;
  },

  inviteAdmin: async (communityId: number, identifier: { username?: string; email?: string }) => {
    const response = await api.post(`/api/communities/${communityId}/admins/invite`, identifier);
    return response.data;
  },

  getJoinRequests: async (communityId: number, statusFilter?: string) => {
    const response = await api.get(`/api/communities/${communityId}/join-requests`, {
      params: { status_filter: statusFilter },
    });
    return response.data;
  },

  reviewJoinRequest: async (requestId: number, approved: boolean, customStartingBalance?: number) => {
    const response = await api.post(`/api/join-requests/${requestId}/review`, null, {
      params: { approved, custom_starting_balance: customStartingBalance },
    });
    return response.data;
  },

  delete: async (communityId: number) => {
    const response = await api.delete(`/api/communities/${communityId}`);
    return response.data;
  },
};

// Wallets API
export const walletsApi = {
  getAll: async () => {
    const response = await api.get('/api/wallets');
    return response.data;
  },
};

// Leagues API
export const leaguesApi = {
  getAll: async () => {
    const response = await api.get('/api/leagues');
    return response.data;
  },

  create: async (name: string, description: string) => {
    const response = await api.post('/api/leagues', {
      name,
      description,
    });
    return response.data;
  },

  getAdmins: async (leagueId: number) => {
    const response = await api.get(`/api/leagues/${leagueId}/admins`);
    return response.data;
  },

  inviteAdmin: async (leagueId: number, identifier: { username?: string; email?: string }) => {
    const response = await api.post(`/api/leagues/${leagueId}/admins/invite`, identifier);
    return response.data;
  },

  requestToJoin: async (leagueId: number, message?: string) => {
    const response = await api.post(`/api/leagues/${leagueId}/request-join`, null, {
      params: { message },
    });
    return response.data;
  },

  delete: async (leagueId: number) => {
    const response = await api.delete(`/api/leagues/${leagueId}`);
    return response.data;
  },
};

// Tables API
export const tablesApi = {
  getByCommunity: async (communityId: number) => {
    const response = await api.get(`/api/communities/${communityId}/tables`);
    return response.data;
  },

  getMyActiveSeat: async () => {
    const response = await api.get('/api/tables/me/active-seat');
    return response.data;
  },

  create: async (communityId: number, tableData: {
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
  }) => {
    const response = await api.post(`/api/communities/${communityId}/tables`, tableData);
    return response.data;
  },

  getSeats: async (tableId: number) => {
    const response = await api.get(`/api/tables/${tableId}/seats`);
    return response.data;
  },

  join: async (tableId: number, buyInAmount: number, seatNumber: number) => {
    const response = await api.post(`/api/tables/${tableId}/join`, {
      buy_in_amount: buyInAmount,
      seat_number: seatNumber,
    });
    return response.data;
  },

  leave: async (tableId: number) => {
    const response = await api.post(`/api/tables/${tableId}/leave`);
    return response.data;
  },

  getTournamentDetails: async (tableId: number) => {
    const response = await api.get(`/api/tables/${tableId}/tournament`);
    return response.data;
  },

  registerTournament: async (tableId: number) => {
    const response = await api.post(`/api/tables/${tableId}/tournament/register`);
    return response.data;
  },

  confirmTournament: async (tableId: number) => {
    const response = await api.post(`/api/tables/${tableId}/tournament/confirm`);
    return response.data;
  },

  unregisterTournament: async (tableId: number) => {
    const response = await api.delete(`/api/tables/${tableId}/tournament/register`);
    return response.data;
  },

  updateTournamentPayout: async (tableId: number, payout: number[], isPercentage: boolean) => {
    const response = await api.patch(`/api/tables/${tableId}/tournament/payout`, { payout, is_percentage: isPercentage });
    return response.data;
  },
};

// Inbox API
export const inboxApi = {
  getMessages: async (unreadOnly: boolean = false) => {
    const response = await api.get('/api/inbox', {
      params: { unread_only: unreadOnly },
    });
    return response.data;
  },

  getUnreadCount: async () => {
    const response = await api.get('/api/inbox/unread-count');
    return response.data;
  },

  markAsRead: async (messageId: number) => {
    const response = await api.post(`/api/inbox/${messageId}/read`);
    return response.data;
  },

  takeAction: async (messageId: number, action: string, customStartingBalance?: number) => {
    const params: Record<string, string | number> = { action };
    if (typeof customStartingBalance === 'number' && Number.isFinite(customStartingBalance)) {
      params.custom_starting_balance = customStartingBalance;
    }
    const response = await api.post(`/api/inbox/${messageId}/action`, null, {
      params,
    });
    return response.data;
  },
};

// Hand history API
export const handsApi = {
  getMine: async (limit: number = 50, offset: number = 0) => {
    const response = await api.get('/api/me/hands', {
      params: { limit, offset },
    });
    return response.data;
  },

  getById: async (handId: string) => {
    const response = await api.get(`/api/hands/${handId}`);
    return response.data;
  },
};

// Learning API
export const learningApi = {
  getSessions: async () => {
    const response = await api.get('/api/learning/sessions');
    return response.data;
  },

  getSessionHands: async (sessionId: number) => {
    const response = await api.get(`/api/learning/sessions/${sessionId}/hands`);
    return response.data;
  },

  recommendAction: async (payload: {
    street: 'preflop' | 'flop' | 'turn' | 'river';
    hole_cards: Array<{ rank: string; suit: string }>;
    community_cards: Array<{ rank: string; suit: string }>;
    pot: number;
    to_call: number;
    min_raise: number;
    stack: number;
    players_in_hand: number;
    can_check: boolean;
    position?: string;
  }) => {
    const response = await api.post('/api/learning/coach/recommend', payload);
    return response.data;
  },
};

// User discovery API
export const usersApi = {
  search: async (query: string) => {
    const response = await api.get('/api/users/search', {
      params: { q: query },
    });
    return response.data;
  },
};

export const playerNotesApi = {
  get: async (targetUserId: number) => {
    const response = await api.get(`/api/player-notes/${targetUserId}`);
    return response.data;
  },

  upsert: async (targetUserId: number, notes: string) => {
    const response = await api.put(`/api/player-notes/${targetUserId}`, { notes });
    return response.data;
  },
};

// Direct message API
export const messagesApi = {
  getConversations: async () => {
    const response = await api.get('/api/messages/conversations');
    return response.data;
  },

  getThread: async (otherUserId: number) => {
    const response = await api.get(`/api/messages/${otherUserId}`);
    return response.data;
  },

  send: async (recipientUserId: number, content: string) => {
    const response = await api.post(`/api/messages/${recipientUserId}`, { content });
    return response.data;
  },
};

// Skins API
export const skinsApi = {
  getCatalog: async (category?: string) => {
    const response = await api.get('/api/skins/catalog', {
      params: { category },
    });
    return response.data;
  },

  getMySkins: async () => {
    const response = await api.get('/api/me/skins');
    return response.data;
  },

  equip: async (skinId: number, equip: boolean = true) => {
    const response = await api.post(`/api/skins/${skinId}/equip`, { equip });
    return response.data;
  },

  submitDesign: async (payload: {
    name: string;
    category: string;
    desired_price_gold_coins: number;
    reference_image_url?: string;
    submitter_notes?: string;
    design_spec?: Record<string, unknown>;
  }) => {
    const response = await api.post('/api/skins/submit-design', payload);
    return response.data;
  },

  listSubmissions: async (statusFilter?: string, workflowStateFilter?: string) => {
    const response = await api.get('/api/admin/skin-submissions', {
      params: { status_filter: statusFilter, workflow_state_filter: workflowStateFilter },
    });
    return response.data;
  },

  getMySubmissions: async () => {
    const response = await api.get('/api/skins/submissions/me');
    return response.data;
  },

  reviewSubmission: async (submissionId: number, payload: {
    action: 'accept' | 'decline';
    review_notes?: string;
    publish_price_gold_coins?: number;
    publish_preview_url?: string;
    proposed_design_spec?: Record<string, unknown>;
  }) => {
    const response = await api.post(`/api/admin/skin-submissions/${submissionId}/review`, payload);
    return response.data;
  },

  creatorDecision: async (submissionId: number, accept: boolean, creatorComment?: string) => {
    const response = await api.post(`/api/skins/submissions/${submissionId}/creator-decision`, {
      accept,
      creator_comment: creatorComment,
    });
    return response.data;
  },
};

// Marketplace API
export const marketplaceApi = {
  getGoldBalance: async () => {
    const response = await api.get('/api/me/gold-balance');
    return response.data;
  },

  getItems: async () => {
    const response = await api.get('/api/marketplace/items');
    return response.data;
  },

  buySkin: async (skinId: number) => {
    const response = await api.post(`/api/marketplace/items/${skinId}/buy`);
    return response.data;
  },

  getCoinPackages: async () => {
    const response = await api.get('/api/marketplace/coin-packages');
    return response.data;
  },

  createCoinPurchaseIntent: async (packageKey: string) => {
    const response = await api.post('/api/marketplace/coin-purchase-intents', {
      package_key: packageKey,
    });
    return response.data;
  },

  completeCoinPurchaseIntentAsAdmin: async (intentId: number) => {
    const response = await api.post(`/api/admin/coin-purchase-intents/${intentId}/complete`);
    return response.data;
  },

  getCreatorEarnings: async () => {
    const response = await api.get('/api/me/creator-earnings');
    return response.data;
  },

  updateCreatorPayoutProfile: async (payoutEmail: string) => {
    const response = await api.patch('/api/me/creator-earnings/profile', {
      payout_email: payoutEmail,
    });
    return response.data;
  },

  listMyCreatorPayoutRequests: async () => {
    const response = await api.get('/api/me/creator-payout-requests');
    return response.data;
  },

  requestCreatorPayout: async (amountCents?: number) => {
    const response = await api.post('/api/me/creator-payout-requests', {
      amount_cents: amountCents,
    });
    return response.data;
  },

  listCreatorPayoutRequestsAsAdmin: async (statusFilter?: string) => {
    const response = await api.get('/api/admin/creator-payout-requests', {
      params: { status_filter: statusFilter },
    });
    return response.data;
  },

  processCreatorPayoutRequestAsAdmin: async (
    requestId: number,
    payload: { action: 'mark_paid' | 'reject'; processor_note?: string; payout_reference?: string }
  ) => {
    const response = await api.post(`/api/admin/creator-payout-requests/${requestId}/process`, payload);
    return response.data;
  },
};

// Tournament API
export const tournamentsApi = {
  list: async () => {
    const response = await api.get('/api/tournaments');
    return response.data;
  },

  createAsAdmin: async (payload: {
    name: string;
    description?: string;
    gold_prize_pool: number;
    starts_at?: string;
    ends_at?: string;
    status?: 'draft' | 'announced' | 'running' | 'completed' | 'canceled';
  }) => {
    const response = await api.post('/api/admin/tournaments', payload);
    return response.data;
  },

  awardAsAdmin: async (tournamentId: number, payouts: Array<{ user_id: number; gold_awarded: number; rank?: number }>) => {
    const response = await api.post(`/api/admin/tournaments/${tournamentId}/award`, { payouts });
    return response.data;
  },
};

// Feedback API
export const feedbackApi = {
  submit: async (payload: {
    feedback_type: 'bug' | 'feedback';
    title: string;
    description: string;
    context?: Record<string, unknown>;
  }) => {
    const response = await api.post('/api/feedback', payload);
    return response.data;
  },

  listAsAdmin: async () => {
    const response = await api.get('/api/admin/feedback');
    return response.data;
  },

  complaintBucketsAsAdmin: async () => {
    const response = await api.get('/api/admin/feedback/complaints');
    return response.data;
  },
};
