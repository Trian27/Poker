import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextType } from '../../auth-context';
import CommunityLobbyPage from '../CommunityLobbyPage';

const {
  getCommunitiesMock,
  getWalletsMock,
  getTablesByCommunityMock,
  getMyActiveSeatMock,
  getQueueMock,
  joinQueueMock,
  leaveQueueMock,
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
  getQueueMock: vi.fn(async () => []),
  joinQueueMock: vi.fn(async () => ({
    table_id: 11,
    user_id: 7,
    username: 'smoke-user',
    position: 1,
    joined_at: '2026-01-01T00:00:00Z',
  })),
  leaveQueueMock: vi.fn(async () => undefined),
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
    getQueue: getQueueMock,
    joinQueue: joinQueueMock,
    leaveQueue: leaveQueueMock,
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

const renderLobby = (initialEntries: Array<string | { pathname: string; state?: unknown }> = ['/community/1']) => render(
  <AuthContext.Provider value={authValue}>
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/community/:communityId" element={<CommunityLobbyPage />} />
      </Routes>
    </MemoryRouter>
  </AuthContext.Provider>,
);

const makeCashTable = (overrides: Record<string, unknown> = {}) => ({
  id: 11,
  community_id: 1,
  name: 'Queue Table',
  status: 'waiting',
  game_type: 'cash',
  max_seats: 2,
  small_blind: 10,
  big_blind: 20,
  buy_in: 200,
  is_permanent: false,
  created_by_user_id: 7,
  max_queue_size: 2,
  action_timeout_seconds: 30,
  agents_allowed: true,
  occupied_seat_count: 2,
  queue_count: 0,
  my_queue_position: null,
  my_queue_buy_in_amount: null,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('CommunityLobbyPage reconnect recovery behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    window.sessionStorage.clear();
  });

  it('shows the seat-lost banner when arriving from stale-route recovery', async () => {
    renderLobby([{ pathname: '/community/1', state: { seat_lost: true } }]);

    await waitFor(() => {
      expect(screen.getByTestId('seat-lost-banner')).toHaveTextContent('You are no longer seated at that table.');
    });
  });

  it('renders Join Queue when a cash table is full and queueing is available', async () => {
    getTablesByCommunityMock.mockResolvedValueOnce([makeCashTable()] as any);

    renderLobby();

    await waitFor(() => {
      expect(screen.getByTestId('join-queue-button')).toHaveTextContent('Join Queue');
    });

    expect(screen.getByText('Queue Table')).toBeInTheDocument();
    expect(screen.getByText('Queue:')).toBeInTheDocument();
    expect(screen.getByText('0/2')).toBeInTheDocument();
  });

  it('renders queued state when the current user is already in the queue', async () => {
    getTablesByCommunityMock.mockResolvedValueOnce([
      makeCashTable({
        queue_count: 1,
        my_queue_position: 1,
        my_queue_buy_in_amount: 250,
      }),
    ] as any);

    renderLobby();

    await waitFor(() => {
      expect(screen.getByTestId('queue-position-label')).toHaveTextContent('In Queue (#1)');
    });

    expect(screen.getByTestId('leave-queue-button')).toHaveTextContent('Leave Queue');
  });

  it('shows the promotion banner when a queued user becomes seated on refresh', async () => {
    getTablesByCommunityMock
      .mockResolvedValueOnce([
        makeCashTable({
          queue_count: 1,
          my_queue_position: 1,
          my_queue_buy_in_amount: 250,
        }),
      ] as any)
      .mockResolvedValueOnce([
        makeCashTable({
          queue_count: 0,
          my_queue_position: null,
          my_queue_buy_in_amount: null,
        }),
      ] as any)
      .mockResolvedValue([
        makeCashTable({
          queue_count: 0,
          my_queue_position: null,
          my_queue_buy_in_amount: null,
        }),
      ] as any);
    getMyActiveSeatMock
      .mockResolvedValueOnce({
        active: false,
        table_id: undefined,
        community_id: undefined,
        seat_number: undefined,
      } as any)
      .mockResolvedValueOnce({
        active: true,
        table_id: 11,
        community_id: 1,
        seat_number: 1,
      } as any)
      .mockResolvedValue({
        active: true,
        table_id: 11,
        community_id: 1,
        seat_number: 1,
      } as any);

    renderLobby();

    await waitFor(() => {
      expect(screen.getByTestId('queue-position-label')).toHaveTextContent('In Queue (#1)');
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('queue-promoted-banner')).toHaveTextContent('A seat opened at this table. You are now seated.');
    });
    expect(screen.getByTestId('join-table-button')).toHaveTextContent('Rejoin Table');
  });
});
