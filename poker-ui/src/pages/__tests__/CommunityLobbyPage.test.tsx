import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextType } from '../../auth-context';
import CommunityLobbyPage from '../CommunityLobbyPage';

const {
  getCommunitiesMock,
  getWalletsMock,
  getTablesByCommunityMock,
  getMyActiveSeatMock,
  getQueueMock,
  getSeatsMock,
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
  getSeatsMock: vi.fn(async () => []),
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
    getSeats: getSeatsMock,
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

const makeSeat = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  seat_number: 1,
  user_id: null,
  username: null,
  occupied_at: null,
  ...overrides,
});

const buildAxiosError = (status: number, payload: Record<string, unknown> | string) => {
  const data = typeof payload === 'string' ? { detail: payload } : payload;
  const message = typeof data.detail === 'string'
    ? data.detail
    : typeof data.error === 'string'
      ? data.error
      : typeof data.message === 'string'
        ? data.message
        : `Request failed with status code ${status}`;

  return {
    isAxiosError: true,
    message,
    response: {
      status,
      data,
    },
  };
};

const mockAlert = () => vi.spyOn(window, 'alert').mockImplementation(() => undefined);

const getJoinModal = async (title: string | RegExp) => {
  const heading = await screen.findByRole('heading', { name: title });
  const modal = heading.closest('.modal-content');
  if (!(modal instanceof HTMLElement)) {
    throw new Error('Join modal not found');
  }
  return modal;
};

const openQueueModal = async (user = userEvent.setup()) => {
  await waitFor(() => {
    expect(screen.getByTestId('join-queue-button')).toHaveTextContent('Join Queue');
  });
  await user.click(screen.getByTestId('join-queue-button'));
  const modal = await getJoinModal('Join Queue for Queue Table');
  return { user, modal };
};

describe('CommunityLobbyPage behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    window.sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    getTablesByCommunityMock.mockResolvedValue([] as any);
    getMyActiveSeatMock.mockResolvedValue({
      active: false,
      table_id: undefined,
      community_id: undefined,
      seat_number: undefined,
    } as any);
    getQueueMock.mockResolvedValue([] as any);
    getSeatsMock.mockResolvedValue([] as any);
    joinQueueMock.mockResolvedValue({
      table_id: 11,
      user_id: 7,
      username: 'smoke-user',
      position: 1,
      joined_at: '2026-01-01T00:00:00Z',
    } as any);
    leaveQueueMock.mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    expect(screen.queryByTestId('join-table-button')).not.toBeInTheDocument();
    expect(screen.getByText('Queue Table')).toBeInTheDocument();
    expect(screen.getByText('Queue:')).toBeInTheDocument();
    expect(screen.getByText('0/2')).toBeInTheDocument();
  });

  it('renders Queue Full when a full cash table has no queue space left', async () => {
    getTablesByCommunityMock.mockResolvedValueOnce([
      makeCashTable({ queue_count: 2 }),
    ] as any);

    renderLobby();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Queue Full' })).toBeDisabled();
    });

    expect(screen.queryByTestId('join-queue-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('join-table-button')).not.toBeInTheDocument();
  });

  it('renders Table Full when a full cash table does not allow queueing', async () => {
    getTablesByCommunityMock.mockResolvedValueOnce([
      makeCashTable({ max_queue_size: 0 }),
    ] as any);

    renderLobby();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Table Full' })).toBeDisabled();
    });

    expect(screen.queryByTestId('join-queue-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('join-table-button')).not.toBeInTheDocument();
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
    expect(screen.queryByTestId('join-queue-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('join-table-button')).not.toBeInTheDocument();
  });

  it('opens the queue modal in queue mode and loads queue details', async () => {
    getTablesByCommunityMock.mockResolvedValueOnce([makeCashTable()] as any);
    getQueueMock.mockResolvedValueOnce([
      {
        table_id: 11,
        user_id: 8,
        username: 'other-player',
        position: 1,
        joined_at: '2026-01-01T00:05:00Z',
      },
    ] as any);

    renderLobby();
    const { modal } = await openQueueModal();

    expect(within(modal).getByRole('heading', { name: 'Join Queue for Queue Table' })).toBeInTheDocument();
    expect(within(modal).getByTestId('queue-buy-in-input')).toHaveValue(200);
    expect(within(modal).getByTestId('confirm-queue-button')).toBeInTheDocument();
    expect(within(modal).getByText('Queue')).toBeInTheDocument();
    expect(within(modal).getByText('other-player')).toBeInTheDocument();
    expect(within(modal).queryByText('Select Your Seat')).not.toBeInTheDocument();
  });

  it('keeps the queue modal open and does not refresh tables when buy-in exceeds wallet balance', async () => {
    const alertSpy = mockAlert();
    getTablesByCommunityMock.mockResolvedValueOnce([makeCashTable()] as any);

    renderLobby();
    const { user, modal } = await openQueueModal();
    const buyInInput = within(modal).getByTestId('queue-buy-in-input');

    await user.clear(buyInInput);
    await user.type(buyInInput, '3000');

    const tableLoadCallsBeforeSubmit = getTablesByCommunityMock.mock.calls.length;
    await user.click(within(modal).getByTestId('confirm-queue-button'));

    expect(joinQueueMock).not.toHaveBeenCalled();
    expect(getTablesByCommunityMock).toHaveBeenCalledTimes(tableLoadCallsBeforeSubmit);
    expect(alertSpy).toHaveBeenCalledWith('Insufficient funds! You have 2500 chips but need 3000.');
    expect(screen.getByRole('heading', { name: 'Join Queue for Queue Table' })).toBeInTheDocument();
  });

  it('keeps the queue modal open and does not refresh tables when buy-in is below the minimum', async () => {
    const alertSpy = mockAlert();
    getTablesByCommunityMock.mockResolvedValueOnce([makeCashTable()] as any);

    renderLobby();
    const { user, modal } = await openQueueModal();
    const buyInInput = within(modal).getByTestId('queue-buy-in-input');

    await user.clear(buyInInput);
    await user.type(buyInInput, '150');

    const tableLoadCallsBeforeSubmit = getTablesByCommunityMock.mock.calls.length;
    await user.click(within(modal).getByTestId('confirm-queue-button'));

    expect(joinQueueMock).not.toHaveBeenCalled();
    expect(getTablesByCommunityMock).toHaveBeenCalledTimes(tableLoadCallsBeforeSubmit);
    expect(alertSpy).toHaveBeenCalledWith('Minimum buy-in is 200 chips.');
    expect(screen.getByRole('heading', { name: 'Join Queue for Queue Table' })).toBeInTheDocument();
  });

  it('updates the lobby card after a successful queue join', async () => {
    getTablesByCommunityMock
      .mockResolvedValueOnce([makeCashTable()] as any)
      .mockResolvedValue([
        makeCashTable({
          queue_count: 1,
          my_queue_position: 1,
          my_queue_buy_in_amount: 350,
        }),
      ] as any);

    renderLobby();
    const { user, modal } = await openQueueModal();
    const buyInInput = within(modal).getByTestId('queue-buy-in-input');

    await user.clear(buyInInput);
    await user.type(buyInInput, '350');
    await user.click(within(modal).getByTestId('confirm-queue-button'));

    await waitFor(() => {
      expect(screen.getByTestId('queue-position-label')).toHaveTextContent('In Queue (#1)');
    });

    expect(joinQueueMock).toHaveBeenCalledWith(11, 350);
    expect(screen.getByTestId('leave-queue-button')).toHaveTextContent('Leave Queue');
    expect(screen.queryByRole('heading', { name: 'Join Queue for Queue Table' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('join-queue-button')).not.toBeInTheDocument();
  });

  it('updates the card back to not-queued state after leaving the queue without opening the modal', async () => {
    getTablesByCommunityMock
      .mockResolvedValueOnce([
        makeCashTable({
          queue_count: 1,
          my_queue_position: 1,
          my_queue_buy_in_amount: 250,
        }),
      ] as any)
      .mockResolvedValue([
        makeCashTable({
          queue_count: 0,
          my_queue_position: null,
          my_queue_buy_in_amount: null,
        }),
      ] as any);

    renderLobby();

    await waitFor(() => {
      expect(screen.getByTestId('leave-queue-button')).toHaveTextContent('Leave Queue');
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId('leave-queue-button'));

    await waitFor(() => {
      expect(screen.getByTestId('join-queue-button')).toHaveTextContent('Join Queue');
    });

    expect(leaveQueueMock).toHaveBeenCalledWith(11);
    expect(joinQueueMock).not.toHaveBeenCalled();
    expect(getSeatsMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Join Queue for Queue Table' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('queue-position-label')).not.toBeInTheDocument();
  });

  it('rescues the queue modal into seat mode after the queue-specific 409 no-longer-full conflict', async () => {
    const alertSpy = mockAlert();
    getTablesByCommunityMock
      .mockResolvedValueOnce([makeCashTable()] as any)
      .mockResolvedValue([
        makeCashTable({
          occupied_seat_count: 1,
          my_queue_position: null,
          queue_count: 0,
        }),
      ] as any);
    getSeatsMock.mockResolvedValueOnce([
      makeSeat({ id: 1, seat_number: 1, user_id: 8, username: 'other-player', occupied_at: '2026-01-01T00:10:00Z' }),
      makeSeat({ id: 2, seat_number: 2 }),
    ] as any);
    joinQueueMock.mockRejectedValueOnce(
      buildAxiosError(409, { detail: 'Table is no longer full; join a seat instead.' }),
    );

    renderLobby();
    const { user, modal } = await openQueueModal();
    const queueBuyInInput = within(modal).getByTestId('queue-buy-in-input');

    await user.clear(queueBuyInInput);
    await user.type(queueBuyInInput, '350');
    await user.click(within(modal).getByTestId('confirm-queue-button'));

    await waitFor(() => {
      expect(getSeatsMock).toHaveBeenCalledTimes(1);
    });

    const seatModal = await getJoinModal('Join Queue Table');
    expect(joinQueueMock).toHaveBeenCalledWith(11, 350);
    expect(getSeatsMock).toHaveBeenCalledWith(11);
    expect(within(seatModal).queryByTestId('confirm-queue-button')).not.toBeInTheDocument();
    expect(within(seatModal).queryByText('No one is in line yet.')).not.toBeInTheDocument();
    expect(within(seatModal).getByText('Select Your Seat')).toBeInTheDocument();
    expect(within(seatModal).getByTestId('confirm-join-button')).toBeDisabled();
    expect(within(seatModal).getByRole('spinbutton')).toHaveValue(350);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('keeps generic queue failure behavior for non-special 409 conflicts', async () => {
    const alertSpy = mockAlert();
    getTablesByCommunityMock
      .mockResolvedValueOnce([makeCashTable()] as any)
      .mockResolvedValue([makeCashTable()] as any);
    joinQueueMock.mockRejectedValueOnce(buildAxiosError(409, { detail: 'Already queued' }));

    renderLobby();
    const { user, modal } = await openQueueModal();

    await user.click(within(modal).getByTestId('confirm-queue-button'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Already queued');
    });

    expect(screen.getByRole('heading', { name: 'Join Queue for Queue Table' })).toBeInTheDocument();
    expect(screen.getByTestId('confirm-queue-button')).toBeInTheDocument();
    expect(getSeatsMock).not.toHaveBeenCalled();
  });

  it('rescues an open queue modal into seat mode on background refresh and does not oscillate back', async () => {
    const alertSpy = mockAlert();
    getTablesByCommunityMock
      .mockResolvedValueOnce([makeCashTable()] as any)
      .mockResolvedValueOnce([
        makeCashTable({
          occupied_seat_count: 1,
          my_queue_position: null,
        }),
      ] as any)
      .mockResolvedValueOnce([makeCashTable()] as any);
    getSeatsMock.mockResolvedValueOnce([
      makeSeat({ id: 1, seat_number: 1, user_id: 8, username: 'other-player', occupied_at: '2026-01-01T00:10:00Z' }),
      makeSeat({ id: 2, seat_number: 2 }),
    ] as any);

    renderLobby();
    await openQueueModal();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(getSeatsMock).toHaveBeenCalledTimes(1);
    });

    let seatModal = await getJoinModal('Join Queue Table');
    expect(within(seatModal).queryByTestId('confirm-queue-button')).not.toBeInTheDocument();
    expect(within(seatModal).getByText('Select Your Seat')).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    seatModal = await getJoinModal('Join Queue Table');
    expect(within(seatModal).getByText('Select Your Seat')).toBeInTheDocument();
    expect(getSeatsMock).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('keeps the modal in seat mode and uses seat-load error behavior when seat loading fails during rescue', async () => {
    const alertSpy = mockAlert();
    getTablesByCommunityMock
      .mockResolvedValueOnce([makeCashTable()] as any)
      .mockResolvedValue([
        makeCashTable({
          occupied_seat_count: 1,
          my_queue_position: null,
          queue_count: 0,
        }),
      ] as any);
    getSeatsMock.mockRejectedValueOnce(buildAxiosError(500, { detail: 'seat loader exploded' }));
    joinQueueMock.mockRejectedValueOnce(
      buildAxiosError(409, { detail: 'Table is no longer full; join a seat instead.' }),
    );

    renderLobby();
    const { user, modal } = await openQueueModal();

    await user.click(within(modal).getByTestId('confirm-queue-button'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Failed to load seat information');
    });

    const seatModal = await getJoinModal('Join Queue Table');
    expect(alertSpy).not.toHaveBeenCalledWith('Table is no longer full; join a seat instead.');
    expect(getSeatsMock).toHaveBeenCalledTimes(1);
    expect(within(seatModal).getByText('Select Your Seat')).toBeInTheDocument();
    expect(within(seatModal).getByTestId('confirm-join-button')).toBeDisabled();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(getSeatsMock).toHaveBeenCalledTimes(1);
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
