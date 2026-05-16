import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextType } from '../../auth-context';
import { DashboardPage } from '../DashboardPage';
import { suppressAutoRejoinForUserTable } from '../../utils/activeSeatRejoin';

const {
  getCommunitiesMock,
  getWalletsMock,
  getLeaguesMock,
  getUnreadCountMock,
  getMessagesMock,
  getMyActiveSeatMock,
} = vi.hoisted(() => ({
  getCommunitiesMock: vi.fn(async () => [{
    id: 1,
    name: 'Alpha Community',
    description: 'Gameplay community',
    league_id: 1,
    currency: 'chips',
    starting_balance: 1000,
    commissioner_id: 7,
    created_at: '2026-01-01T00:00:00Z',
  }]),
  getWalletsMock: vi.fn(async () => [{
    id: 1,
    user_id: 7,
    community_id: 1,
    balance: 2500,
    created_at: '2026-01-01T00:00:00Z',
  }]),
  getLeaguesMock: vi.fn(async () => [{
    id: 1,
    name: 'Alpha League',
    description: 'Gameplay league',
    currency: 'chips',
    owner_id: 7,
    created_at: '2026-01-01T00:00:00Z',
    is_member: true,
    has_pending_request: false,
  }]),
  getUnreadCountMock: vi.fn(async () => ({ unread_count: 0 })),
  getMessagesMock: vi.fn(async () => []),
  getMyActiveSeatMock: vi.fn(async () => ({
    active: true,
    table_id: 11,
    community_id: 1,
    seat_number: 1,
  })),
}));

vi.mock('../../api', () => ({
  communitiesApi: {
    getAll: getCommunitiesMock,
  },
  walletsApi: {
    getAll: getWalletsMock,
  },
  leaguesApi: {
    getAll: getLeaguesMock,
  },
  inboxApi: {
    getUnreadCount: getUnreadCountMock,
    getMessages: getMessagesMock,
  },
  tablesApi: {
    getMyActiveSeat: getMyActiveSeatMock,
  },
}));

const authValue: AuthContextType = {
  user: {
    id: 7,
    username: 'smoke-user',
    email: 'smoke-user@example.com',
    created_at: '2026-01-01T00:00:00Z',
  },
  token: 'test-token',
  login: vi.fn(),
  logout: vi.fn(),
  setToken: vi.fn(),
  setUser: vi.fn(),
  isAuthenticated: true,
  isReady: true,
  refreshUser: vi.fn(async () => undefined),
};

const renderDashboard = (initialEntries: Array<string | { pathname: string; search?: string; state?: unknown }> = ['/dashboard']) => render(
  <StrictMode>
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/game/:tableId" element={<div>Game route reached</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  </StrictMode>
);

describe('DashboardPage gameplay behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    vi.spyOn(window.performance, 'getEntriesByType').mockImplementation((type: string) => {
      if (type === 'navigation') {
        return [{ type: 'reload' }] as unknown as PerformanceEntry[];
      }
      return [];
    });
  });

  it('auto-rejoins the active seat on reload even under StrictMode double effects', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Game route reached')).toBeInTheDocument();
    });

    expect(getMyActiveSeatMock).toHaveBeenCalled();
    expect(window.sessionStorage.getItem('poker:reloadRejoinChecked')).toBe('1');
  });

  it('does not auto-rejoin when the current user and table are suppressed', async () => {
    suppressAutoRejoinForUserTable(authValue.user!.id, 11, 60_000);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Alpha League')).toBeInTheDocument();
    });

    expect(screen.queryByText('Game route reached')).not.toBeInTheDocument();
  });

  it('shows the seat-lost banner when redirected back to the dashboard', async () => {
    renderDashboard([{ pathname: '/dashboard', state: { seat_lost: true } }]);

    await waitFor(() => {
      expect(screen.getByTestId('seat-lost-banner')).toHaveTextContent('You are no longer seated at that table.');
    });
  });
});
