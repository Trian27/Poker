/**
 * Authentication context and provider
 */
import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { User } from './types';
import { authApi, clearApiAuthStorage, setApiAuthToken } from './api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  setToken: (token: string | null) => void;
  setUser: (user: User) => void;
  isAuthenticated: boolean;
  isReady: boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

const TOKEN_STORAGE_KEY = 'token';
const USER_STORAGE_KEY = 'user';

const clearPersistedAuth = () => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(USER_STORAGE_KEY);
};

const persistAuthForUser = (token: string | null, user: User | null) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (!token || !user || user.is_admin) {
    clearPersistedAuth();
    return;
  }

  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
};

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const refreshUser = async () => {
    try {
      const userData = await authApi.getCurrentUser();
      const newUser: User = {
        id: userData.id,
        username: userData.username,
        email: userData.email,
        created_at: userData.created_at,
        is_admin: userData.is_admin,
        is_banned: userData.is_banned,
      };
      setUser(newUser);
      persistAuthForUser(token, newUser);
    } catch (err) {
      console.error('Failed to refresh user info:', err);
    }
  };

  useEffect(() => {
    const storedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    const storedUser = window.localStorage.getItem(USER_STORAGE_KEY);

    if (!storedToken || !storedUser) {
      setApiAuthToken(null);
      setIsReady(true);
      return;
    }

    try {
      const parsedUser: User = JSON.parse(storedUser);

      // Global admins should always re-authenticate on refresh.
      if (parsedUser.is_admin) {
        clearPersistedAuth();
        setApiAuthToken(null);
        setIsReady(true);
        return;
      }

      setTokenState(storedToken);
      setApiAuthToken(storedToken);
      setUser(parsedUser);

      // Refresh user info if it seems incomplete (missing username or is_admin)
      if (!parsedUser.username || parsedUser.is_admin === undefined) {
        setTimeout(() => refreshUser(), 100);
      }
    } catch (err) {
      console.error('Failed to parse stored auth session:', err);
      clearPersistedAuth();
      setApiAuthToken(null);
    }
    setIsReady(true);
  }, []);

  const login = (newToken: string, newUser: User) => {
    setTokenState(newToken);
    setApiAuthToken(newToken);
    setUser(newUser);
    persistAuthForUser(newToken, newUser);
  };

  const logout = () => {
    clearApiAuthStorage();
    setTokenState(null);
    setUser(null);
  };

  const updateUser = (newUser: User) => {
    setUser(newUser);
    persistAuthForUser(token, newUser);
  };

  const updateToken = (newToken: string | null) => {
    setTokenState(newToken);
    setApiAuthToken(newToken);
    persistAuthForUser(newToken, user);
  };

  const value = {
    user,
    token,
    login,
    logout,
    setToken: updateToken,
    setUser: updateUser,
    isAuthenticated: !!token,
    isReady,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
