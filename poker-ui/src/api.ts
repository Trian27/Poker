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
};

// Communities API
export const communitiesApi = {
  getAll: async () => {
    const response = await api.get('/api/communities');
    return response.data;
  },

  create: async (name: string, description: string, leagueId: number, startingBalance: number) => {
    const response = await api.post('/api/communities', {
      name,
      description,
      league_id: leagueId,
      starting_balance: startingBalance,
    });
    return response.data;
  },

  join: async (communityId: number) => {
    const response = await api.post(`/api/communities/${communityId}/join`);
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
