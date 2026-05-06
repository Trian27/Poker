import type { BrowserContext, Route } from '@playwright/test';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { SMOKE_TEST_TOKEN, SMOKE_TEST_USER } from './session';

const API_ORIGIN = 'http://127.0.0.1:18000';
const GAME_SERVER_PORT = 13000;

const jsonHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': '*',
  'content-type': 'application/json',
};

const baseGameState = {
  gameId: 'table_11',
  stage: 'flop',
  players: [
    {
      id: `player_${SMOKE_TEST_USER.id}_seed`,
      username: SMOKE_TEST_USER.username,
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

export interface GameplayApiMockState {
  activeSeat: { active: boolean; table_id: number | null; community_id: number | null; seat_number: number | null };
  seats: Array<{ id: number; seat_number: number; user_id: number | null; username: string | null; occupied_at: string | null }>;
  requestLog: Array<{ method: string; pathname: string }>;
}

export interface GameplayApiMockOptions {
  activeSeat?: GameplayApiMockState['activeSeat'];
  seats?: GameplayApiMockState['seats'];
}

const fulfillJson = (route: Route, payload: unknown, status: number = 200) =>
  route.fulfill({
    status,
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });

export async function installGameplayApiMocks(
  context: BrowserContext,
  options: GameplayApiMockOptions = {},
): Promise<GameplayApiMockState> {
  const state = {
    activeSeat: options.activeSeat ?? { active: false, table_id: null as number | null, community_id: null as number | null, seat_number: null as number | null },
    seats: options.seats ?? [
      { id: 1101, seat_number: 1, user_id: null, username: null, occupied_at: null },
      { id: 1102, seat_number: 2, user_id: 8, username: 'villain', occupied_at: '2026-01-01T00:00:00Z' },
      { id: 1103, seat_number: 3, user_id: null, username: null, occupied_at: null },
      { id: 1104, seat_number: 4, user_id: null, username: null, occupied_at: null },
    ],
    requestLog: [] as Array<{ method: string; pathname: string }>,
  };

  await context.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const { pathname } = url;
    state.requestLog.push({ method, pathname });

    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: jsonHeaders, body: '' });
      return;
    }

    if (method === 'POST' && pathname === '/auth/login') {
      await fulfillJson(route, {
        access_token: SMOKE_TEST_TOKEN,
        token_type: 'bearer',
        user: SMOKE_TEST_USER,
      });
      return;
    }

    if (method === 'GET' && pathname === '/auth/me') {
      await fulfillJson(route, SMOKE_TEST_USER);
      return;
    }

    if (method === 'GET' && pathname === '/api/leagues') {
      await fulfillJson(route, [{
        id: 1,
        name: 'Alpha League',
        description: 'Gameplay league',
        currency: 'chips',
        owner_id: SMOKE_TEST_USER.id,
        created_at: '2026-01-01T00:00:00Z',
        is_member: true,
        has_pending_request: false,
      }]);
      return;
    }

    if (method === 'GET' && pathname === '/api/communities') {
      await fulfillJson(route, [{
        id: 1,
        name: 'Alpha Community',
        description: 'Gameplay community',
        league_id: 1,
        currency: 'chips',
        starting_balance: 1000,
        commissioner_id: SMOKE_TEST_USER.id,
        created_at: '2026-01-01T00:00:00Z',
      }]);
      return;
    }

    if (method === 'GET' && pathname === '/api/wallets') {
      await fulfillJson(route, [{
        id: 1,
        user_id: SMOKE_TEST_USER.id,
        community_id: 1,
        balance: 2500,
        created_at: '2026-01-01T00:00:00Z',
      }]);
      return;
    }

    if (method === 'GET' && pathname === '/api/inbox/unread-count') {
      await fulfillJson(route, { unread_count: 0 });
      return;
    }

    if (method === 'GET' && pathname === '/api/inbox') {
      await fulfillJson(route, []);
      return;
    }

    if (method === 'GET' && pathname === '/api/tables/me/active-seat') {
      await fulfillJson(route, state.activeSeat);
      return;
    }

    if (method === 'GET' && pathname === '/api/communities/1/tables') {
      await fulfillJson(route, [{
        id: 11,
        community_id: 1,
        name: 'Cash Table 1',
        status: 'waiting',
        game_type: 'cash',
        max_seats: 4,
        small_blind: 10,
        big_blind: 20,
        buy_in: 200,
        created_at: '2026-01-01T00:00:00Z',
        agents_allowed: true,
      }]);
      return;
    }

    if (method === 'GET' && pathname === '/api/tables/11/seats') {
      await fulfillJson(route, state.seats);
      return;
    }

    if (method === 'POST' && pathname === '/api/tables/11/join') {
      state.activeSeat = { active: true, table_id: 11, community_id: 1, seat_number: 1 };
      state.seats[0] = {
        id: 1101,
        seat_number: 1,
        user_id: SMOKE_TEST_USER.id,
        username: SMOKE_TEST_USER.username,
        occupied_at: '2026-01-01T00:00:00Z',
      };
      await fulfillJson(route, {
        success: true,
        message: 'Successfully joined table with 200 chips',
        new_balance: 2300,
        table_id: 11,
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/tables/11/leave') {
      state.activeSeat = { active: false, table_id: null, community_id: null, seat_number: null };
      await fulfillJson(route, { success: true, message: 'Left table' });
      return;
    }

    if (method === 'GET' && pathname === '/api/me/skins') {
      await fulfillJson(route, []);
      return;
    }

    await fulfillJson(route, {});
  });

  return state;
}

export class MockGameplaySocketServer {
  private httpServer: HttpServer;
  private io: SocketIOServer;
  private started = false;
  public readonly receivedActions: Array<{ action: string; amount?: number }> = [];

  constructor() {
    this.httpServer = createServer();
    this.io = new SocketIOServer(this.httpServer, {
      cors: { origin: '*' },
      transports: ['websocket', 'polling'],
    });

    this.io.on('connection', (socket) => {
      setTimeout(() => {
        socket.emit('game_state_update', { gameState: baseGameState, botUserIds: [] });
      }, 50);

      socket.on('game_action', (payload: { action: string; amount?: number }) => {
        this.receivedActions.push(payload);
        if (payload.action === 'check') {
          socket.emit('action_error', { error: 'Illegal action from gameplay smoke server' });
        }
      });
    });
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    await new Promise<void>((resolve) => this.httpServer.listen(GAME_SERVER_PORT, '127.0.0.1', () => resolve()));
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    await new Promise<void>((resolve) => this.io.close(() => resolve()));
    if (this.httpServer.listening) {
      await new Promise<void>((resolve, reject) =>
        this.httpServer.close((error) => {
          if (error && error.message !== 'Server is not running.') {
            reject(error);
            return;
          }
          resolve();
        })
      );
    }
    this.started = false;
  }
}
