import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextType } from '../../auth-context';
import CommunityLobbyPage from '../CommunityLobbyPage';

const {
  getCommunitiesMock,
  getWalletsMock,
  getTablesByCommunityMock,
  getMyActiveSeatMock,
  getUnreadCountMock,
  getMessagesMock,
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
  getTablesByCommunityMock: vi.fn(async () => []),
  getMyActiveSeatMock: vi.fn(async () => ({
    active: false,
    table_id: undefined,
    community_id: undefined,
    seat_number: undefined,
  })),
  getUnreadCountMock: vi.fn(async () => ({ unread_count: 0 })),
  getMessagesMock: vi.fn(async () => []),
}));

vi.mock('../../api', () => ({
  communitiesApi: {
    getAll: getCommunitiesMock,
    join: vi.fn(async () => ({ success: true })),
  },
  walletsApi: {
    getAll: getWalletsMock,
  },
  tablesApi: {
    getByCommunity: getTablesByCommunityMock,
    getMyActiveSeat: getMyActiveSeatMock,
  },
  inboxApi: {
    getUnreadCount: getUnreadCountMock,
    getMessages: getMessagesMock,
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

const renderLobby = () => render(
  <AuthContext.Provider value={authValue}>
    <MemoryRouter initialEntries={[{ pathname: '/community/1', state: { seat_lost: true } }]}>
      <Routes>
        <Route path="/community/:communityId" element={<CommunityLobbyPage />} />
      </Routes>
    </MemoryRouter>
  </AuthContext.Provider>,
);

describe('CommunityLobbyPage reconnect recovery behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('shows the seat-lost banner when arriving from stale-route recovery', async () => {
    renderLobby();

    await waitFor(() => {
      expect(screen.getByTestId('seat-lost-banner')).toHaveTextContent('You are no longer seated at that table.');
    });
  });
});
