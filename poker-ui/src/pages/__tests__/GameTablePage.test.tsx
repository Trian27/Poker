import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextType } from '../../auth-context';
import { GameTablePage } from '../GameTablePage';

const {
  fakeSocket,
  createGameSocketMock,
  getSeatsMock,
  getMyActiveSeatMock,
  leaveMock,
  getMySkinsMock,
  getNoteMock,
  upsertNoteMock,
} = vi.hoisted(() => {
  class FakeSocket {
    public connected = false;
    public id = 'fake-socket';
    public emitted: Array<{ event: string; payload: unknown }> = [];
    private handlers = new Map<string, Array<(...args: any[]) => void>>();

    on(event: string, handler: (...args: any[]) => void): FakeSocket {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
      return this;
    }

    once(event: string, handler: (...args: any[]) => void): FakeSocket {
      const wrapped = (...args: any[]) => {
        this.off(event, wrapped);
        handler(...args);
      };
      return this.on(event, wrapped);
    }

    off(event: string, handler: (...args: any[]) => void): void {
      const list = this.handlers.get(event) ?? [];
      this.handlers.set(event, list.filter((candidate) => candidate !== handler));
    }

    emit(event: string, payload?: unknown): FakeSocket {
      this.emitted.push({ event, payload });
      return this;
    }

    close(): void {
      this.connected = false;
    }

    disconnect(): void {
      this.close();
    }

    reset(): void {
      this.connected = false;
      this.emitted = [];
      this.handlers.clear();
    }

    trigger(event: string, payload?: unknown): void {
      if (event === 'connect') {
        this.connected = true;
      }
      if (event === 'disconnect') {
        this.connected = false;
      }
      for (const handler of this.handlers.get(event) ?? []) {
        handler(payload);
      }
    }
  }

  const fakeSocket = new FakeSocket();
  return {
    fakeSocket,
    createGameSocketMock: vi.fn(() => fakeSocket),
    getSeatsMock: vi.fn(async () => [
      { id: 1, seat_number: 1, user_id: 7, username: 'smoke-user', occupied_at: '2026-01-01T00:00:00Z' },
      { id: 2, seat_number: 2, user_id: 8, username: 'villain', occupied_at: '2026-01-01T00:00:00Z' },
    ]),
    getMyActiveSeatMock: vi.fn(async () => ({
      active: true,
      table_id: 11,
      community_id: 1,
      seat_number: 1,
    })),
    leaveMock: vi.fn(async () => ({ success: true })),
    getMySkinsMock: vi.fn(async () => []),
    getNoteMock: vi.fn(async () => ({ notes: '' })),
    upsertNoteMock: vi.fn(async () => ({ notes: 'saved' })),
  };
});

vi.mock('../../gameSocket', () => ({
  createGameSocket: createGameSocketMock,
}));

vi.mock('../../api', () => ({
  tablesApi: {
    getSeats: getSeatsMock,
    getMyActiveSeat: getMyActiveSeatMock,
    leave: leaveMock,
  },
  skinsApi: {
    getMySkins: getMySkinsMock,
  },
  playerNotesApi: {
    get: getNoteMock,
    upsert: upsertNoteMock,
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

const renderGameTable = () => render(
  <AuthContext.Provider value={authValue}>
    <MemoryRouter initialEntries={['/game/11?communityId=1']}>
      <Routes>
        <Route path="/game/:tableId" element={<GameTablePage />} />
        <Route path="/community/:communityId" element={<div>Community page</div>} />
        <Route path="/dashboard" element={<div>Dashboard page</div>} />
      </Routes>
    </MemoryRouter>
  </AuthContext.Provider>
);

const baseRawGameState = {
  gameId: 'table_11',
  stage: 'flop',
  players: [
    {
      id: 'player_7_seed',
      username: 'smoke-user',
      stack: 850,
      currentBet: 0,
      seatNumber: 1,
      hasFolded: false,
      isAllIn: false,
      waitingForBigBlind: false,
      isActive: true,
    },
    {
      id: 'player_8_seed',
      username: 'villain',
      stack: 850,
      currentBet: 0,
      seatNumber: 2,
      hasFolded: false,
      isAllIn: false,
      waitingForBigBlind: false,
      isActive: true,
    },
  ],
  communityCards: [
    { rank: 'A', suit: 'spades' },
    { rank: '7', suit: 'clubs' },
    { rank: '2', suit: 'diamonds' },
  ],
  pot: 40,
  currentPlayerIndex: 0,
  dealerIndex: 0,
  smallBlindIndex: 0,
  bigBlindIndex: 1,
  smallBlind: 10,
  bigBlind: 20,
  minBet: 20,
  minRaiseSize: 20,
  myCards: [
    { rank: 'K', suit: 'hearts' },
    { rank: 'Q', suit: 'hearts' },
  ],
  actionTimeoutSeconds: 30,
  remainingActionTime: 12,
  remainingReserveTime: 30,
};

describe('GameTablePage gameplay behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeSocket.reset();
  });

  it('renders live action controls and emits game actions through the socket adapter', async () => {
    renderGameTable();

    expect(screen.getByText('Connecting to game server...')).toBeInTheDocument();

    act(() => {
      fakeSocket.trigger('connect');
      fakeSocket.trigger('game_state_update', { gameState: baseRawGameState, botUserIds: [] });
    });

    await waitFor(() => expect(screen.getByText('Poker Table')).toBeInTheDocument());
    expect(screen.getByText('Street: flop')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(fakeSocket.emitted.some((event) => event.event === 'game_action' && (event.payload as { action: string }).action === 'check')).toBe(true);

    act(() => {
      fakeSocket.trigger('action_error', { error: 'Illegal action from server' });
    });
    await waitFor(() => expect(screen.getByText('Illegal action from server')).toBeInTheDocument());
  });

  it('shows waiting and reconnect states for gameplay edge cases', async () => {
    renderGameTable();

    act(() => {
      fakeSocket.trigger('connect');
      fakeSocket.trigger('game_state_update', {
        gameState: {
          ...baseRawGameState,
          currentPlayerIndex: 1,
          players: [
            {
              ...baseRawGameState.players[0],
              waitingForBigBlind: true,
              isActive: false,
            },
            baseRawGameState.players[1],
          ],
        },
        botUserIds: [],
      });
    });

    await waitFor(() => expect(screen.getByText('Seated. Waiting until your big blind to enter.')).toBeInTheDocument());

    act(() => {
      fakeSocket.trigger('disconnect');
    });
    await waitFor(() => expect(screen.getByText('Reconnecting to game...')).toBeInTheDocument());
  });

  it('navigates away from a stale player route when the socket reports table_not_found', async () => {
    renderGameTable();

    act(() => {
      fakeSocket.trigger('connect');
      fakeSocket.trigger('error', { message: 'table_not_found', code: 'table_not_found' });
    });

    await waitFor(() => expect(screen.getByText('Community page')).toBeInTheDocument());
  });

  it('navigates away from a stale player route when active-seat fallback no longer matches the table', async () => {
    getMyActiveSeatMock.mockResolvedValueOnce({
      active: false,
      community_id: 1,
    } as any);

    renderGameTable();

    act(() => {
      fakeSocket.trigger('connect');
    });

    await waitFor(() => expect(screen.getByText('Community page')).toBeInTheDocument());
  });
});
