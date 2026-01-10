/**
 * API Client for communicating with FastAPI backend
 */
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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
    const token = localStorage.getItem('token');
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
    if (error.response?.status === 401) {
      // Unauthorized - clear token and redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
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

  requestUpdate: async (newUsername?: string, newEmail?: string) => {
    const response = await api.post('/api/profile/request-update', {
      new_username: newUsername,
      new_email: newEmail,
    });
    return response.data;
  },

  verifyUpdate: async (verificationCode: string, newUsername?: string, newEmail?: string) => {
    const response = await api.post('/api/profile/verify-update', {
      verification_code: verificationCode,
      new_username: newUsername,
      new_email: newEmail,
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
};

// Tables API
export const tablesApi = {
  getByCommunity: async (communityId: number) => {
    const response = await api.get(`/api/communities/${communityId}/tables`);
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
    const response = await api.post(`/api/inbox/${messageId}/action`, null, {
      params: { action, custom_starting_balance: customStartingBalance },
    });
    return response.data;
  },
};
