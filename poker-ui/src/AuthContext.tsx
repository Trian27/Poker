/**
 * Authentication context and provider
 */
import React, { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { User } from './types';
import { authApi, clearApiAuthStorage, getApiAuthToken, setApiAuthToken } from './api';
import { AuthContext } from './auth-context';

interface AuthProviderProps {
  children: ReactNode;
}

const TOKEN_STORAGE_KEY = 'token';
const USER_STORAGE_KEY = 'user';
const SESSION_EXPIRY_STORAGE_KEY = 'auth_session_expires_at';
const PERSISTENT_SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const clearPersistedAuth = () => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(USER_STORAGE_KEY);
  window.localStorage.removeItem(SESSION_EXPIRY_STORAGE_KEY);
};

const readPersistedExpiry = (): number | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const rawValue = window.localStorage.getItem(SESSION_EXPIRY_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
};

const persistAuthForUser = (
  token: string | null,
  user: User | null,
  options?: { refreshExpiry?: boolean }
) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (!token || !user || user.is_admin) {
    clearPersistedAuth();
    return;
  }

  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  if (options?.refreshExpiry) {
    window.localStorage.setItem(
      SESSION_EXPIRY_STORAGE_KEY,
      String(Date.now() + PERSISTENT_SESSION_MS)
    );
  } else if (!window.localStorage.getItem(SESSION_EXPIRY_STORAGE_KEY)) {
    window.localStorage.setItem(
      SESSION_EXPIRY_STORAGE_KEY,
      String(Date.now() + PERSISTENT_SESSION_MS)
    );
  }
};

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const refreshUser = useCallback(async () => {
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
      persistAuthForUser(getApiAuthToken(), newUser);
    } catch (err) {
      console.error('Failed to refresh user info:', err);
    }
  }, []);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    const storedUser = window.localStorage.getItem(USER_STORAGE_KEY);
    const storedExpiry = readPersistedExpiry();

    if (!storedToken || !storedUser || !storedExpiry || Date.now() >= storedExpiry) {
      clearPersistedAuth();
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
        setTimeout(() => {
          void refreshUser();
        }, 100);
      }
    } catch (err) {
      console.error('Failed to parse stored auth session:', err);
      clearPersistedAuth();
      setApiAuthToken(null);
    }
    setIsReady(true);
  }, [refreshUser]);

  const login = (newToken: string, newUser: User, options?: { persist?: boolean }) => {
    setTokenState(newToken);
    setApiAuthToken(newToken);
    setUser(newUser);
    const shouldPersist = options?.persist ?? true;
    if (shouldPersist) {
      persistAuthForUser(newToken, newUser, { refreshExpiry: true });
    } else {
      clearPersistedAuth();
    }
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
