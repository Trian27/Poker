import type { BrowserContext, Route } from '@playwright/test';
import { SMOKE_TEST_TOKEN, SMOKE_TEST_USER } from './session';

const API_ORIGIN = 'http://127.0.0.1:18000';

const leagues = [
  {
    id: 1,
    name: 'Alpha League',
    description: 'Primary league for layout smoke checks.',
    currency: 'chips',
    owner_id: SMOKE_TEST_USER.id,
    created_at: '2026-01-01T00:00:00Z',
    is_member: true,
    has_pending_request: false,
  },
];

const communities = [
  {
    id: 1,
    name: 'Alpha Community',
    description: 'Community used by responsive smoke tests.',
    league_id: 1,
    currency: 'chips',
    starting_balance: 1000,
    commissioner_id: SMOKE_TEST_USER.id,
    created_at: '2026-01-01T00:00:00Z',
  },
];

const wallets = [
  {
    id: 1,
    user_id: SMOKE_TEST_USER.id,
    community_id: 1,
    balance: 2500,
    created_at: '2026-01-01T00:00:00Z',
  },
];

const communityTables = [
  {
    id: 11,
    community_id: 1,
    name: 'Cash Table 1',
    status: 'waiting',
    game_type: 'cash',
    max_seats: 8,
    small_blind: 10,
    big_blind: 20,
    buy_in: 200,
    created_at: '2026-01-01T00:00:00Z',
    agents_allowed: true,
  },
  {
    id: 12,
    community_id: 1,
    name: 'Sunday Deep Stack Tournament',
    status: 'waiting',
    game_type: 'tournament',
    max_seats: 8,
    small_blind: 50,
    big_blind: 100,
    buy_in: 100,
    created_at: '2026-01-01T00:00:00Z',
    agents_allowed: true,
    tournament_state: 'scheduled',
    tournament_start_time: '2026-12-31T20:00:00Z',
    tournament_starting_stack: 2000,
    tournament_registration_count: 2,
    tournament_prize_pool: 200,
    tournament_is_registered: false,
  },
];

const seatsByTableId: Record<number, Array<{ id: number; seat_number: number; user_id: number | null; username: string | null; occupied_at: string | null }>> = {
  11: [
    { id: 1101, seat_number: 1, user_id: SMOKE_TEST_USER.id, username: SMOKE_TEST_USER.username, occupied_at: '2026-01-01T00:00:00Z' },
    { id: 1102, seat_number: 2, user_id: null, username: null, occupied_at: null },
    { id: 1103, seat_number: 3, user_id: 8, username: 'tester', occupied_at: '2026-01-01T00:00:00Z' },
    { id: 1104, seat_number: 4, user_id: null, username: null, occupied_at: null },
    { id: 1105, seat_number: 5, user_id: null, username: null, occupied_at: null },
    { id: 1106, seat_number: 6, user_id: null, username: null, occupied_at: null },
    { id: 1107, seat_number: 7, user_id: null, username: null, occupied_at: null },
    { id: 1108, seat_number: 8, user_id: null, username: null, occupied_at: null },
  ],
  12: [
    { id: 1201, seat_number: 1, user_id: null, username: null, occupied_at: null },
    { id: 1202, seat_number: 2, user_id: null, username: null, occupied_at: null },
    { id: 1203, seat_number: 3, user_id: null, username: null, occupied_at: null },
    { id: 1204, seat_number: 4, user_id: null, username: null, occupied_at: null },
    { id: 1205, seat_number: 5, user_id: null, username: null, occupied_at: null },
    { id: 1206, seat_number: 6, user_id: null, username: null, occupied_at: null },
    { id: 1207, seat_number: 7, user_id: null, username: null, occupied_at: null },
    { id: 1208, seat_number: 8, user_id: null, username: null, occupied_at: null },
  ],
};

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': '*',
};

const jsonHeaders = {
  ...corsHeaders,
  'content-type': 'application/json',
};

const fulfillJson = (route: Route, payload: unknown, status: number = 200) =>
  route.fulfill({
    status,
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });

async function handleApiRoute(route: Route): Promise<void> {
  const request = route.request();
  const method = request.method().toUpperCase();
  const url = new URL(request.url());
  const { pathname } = url;

  if (method === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    return;
  }

  if (method === 'POST' && pathname === '/auth/login') {
    await fulfillJson(route, {
      access_token: SMOKE_TEST_TOKEN,
      token_type: 'bearer',
      user: SMOKE_TEST_USER,
      requires_2fa: false,
    });
    return;
  }

  if (method === 'POST' && pathname === '/auth/register') {
    await fulfillJson(route, {
      ...SMOKE_TEST_USER,
      username: 'registered-user',
      email: 'registered-user@example.com',
      requires_verification: false,
    });
    return;
  }

  if (method === 'GET' && pathname === '/auth/me') {
    await fulfillJson(route, SMOKE_TEST_USER);
    return;
  }

  if (method === 'GET' && pathname === '/api/leagues') {
    await fulfillJson(route, leagues);
    return;
  }

  if (method === 'GET' && pathname === '/api/communities') {
    await fulfillJson(route, communities);
    return;
  }

  if (method === 'GET' && pathname === '/api/wallets') {
    await fulfillJson(route, wallets);
    return;
  }

  if (method === 'GET' && pathname === '/api/inbox/unread-count') {
    await fulfillJson(route, { unread_count: 2 });
    return;
  }

  if (method === 'GET' && pathname === '/api/inbox') {
    await fulfillJson(route, []);
    return;
  }

  if (method === 'POST' && pathname.startsWith('/api/inbox/') && pathname.endsWith('/read')) {
    await fulfillJson(route, { success: true });
    return;
  }

  if (method === 'GET' && pathname === '/api/tables/me/active-seat') {
    await fulfillJson(route, { active: false, table_id: null, community_id: null });
    return;
  }

  if (method === 'GET' && pathname === '/api/communities/1/tables') {
    await fulfillJson(route, communityTables);
    return;
  }

  if (method === 'GET' && pathname.startsWith('/api/tables/') && pathname.endsWith('/seats')) {
    const tableId = Number(pathname.split('/')[3]);
    await fulfillJson(route, seatsByTableId[tableId] || []);
    return;
  }

  await fulfillJson(route, {});
}

export async function installApiMocks(context: BrowserContext): Promise<void> {
  await context.route(`${API_ORIGIN}/**`, handleApiRoute);
}
