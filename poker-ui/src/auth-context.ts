import { createContext, useContext } from 'react';
import type { User } from './types';

export interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User, options?: { persist?: boolean }) => void;
  logout: () => void;
  setToken: (token: string | null) => void;
  setUser: (user: User) => void;
  isAuthenticated: boolean;
  isReady: boolean;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
