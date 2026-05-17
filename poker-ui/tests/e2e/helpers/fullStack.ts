import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { expect, request as playwrightRequest } from '@playwright/test';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const RUN_TAG_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SECRET_KEYS = new Set([
  'password',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'set-cookie',
]);

export interface FixtureUserCredential {
  user_id: number;
  username: string;
  email: string;
  password: string;
  is_test_user: boolean;
  seat_number: number | null;
  queue_position: number | null;
}

export interface GameplayFixture {
  run_tag: string;
  auto_seat_players: boolean;
  league_id: number;
  league_name: string;
  community_id: number;
  community_name: string;
  table_id: number;
  table_name: string;
  game_id: string;
  users: FixtureUserCredential[];
}

export interface FixtureCreateOptions {
  autoSeatPlayers?: boolean;
  actionTimeoutSeconds?: number;
  playerCount?: number;
  queuedPlayerCount?: number;
  startingBalance?: string;
  buyIn?: number;
  smallBlind?: number;
  bigBlind?: number;
  maxSeats?: number;
  maxQueueSize?: number;
}

export interface AuthenticatedApiUser {
  username: string;
  password: string;
  userId: number;
  token: string;
  request: APIRequestContext;
}

export interface SeatSnapshot {
  tableId: string;
  userA: {
    userId: string;
    seatNumber: number | null;
    activeSeatTableId: string | null;
    activeSeatNumber: number | null;
  };
  userB: {
    userId: string;
    seatNumber: number | null;
    activeSeatTableId: string | null;
    activeSeatNumber: number | null;
  };
  seats: Array<{
    userId: string;
    seatNumber: number;
  }>;
}

export interface QueueSnapshot {
  userId: string;
  position: number;
  reservedBuyInAmount: number | null;
}

interface CleanupSummary {
  attempted: boolean;
  succeeded: boolean;
  status?: string | null;
  deleted?: Record<string, number>;
  error?: string | null;
}

interface DisruptionSummary {
  type?: string | null;
  target_user?: string | null;
  offline_started_at?: string | null;
  reconnecting_observed_at?: string | null;
  active_seat_inactive_at?: string | null;
  online_restored_at?: string | null;
}

interface FullStackSummary {
  mode: 'compose-browser-pr-smoke' | 'compose-browser-queue-pr' | 'compose-browser-e2e';
  scenario: string;
  required_check: boolean;
  phase: string;
  status: 'running' | 'passed' | 'failed';
  error: string | null;
  run_tag: string | null;
  fixture_create_dispatched: boolean;
  fixture_create_succeeded: boolean;
  auto_seat_players: boolean;
  league_id: number | null;
  league_name: string | null;
  community_id: number | null;
  community_name: string | null;
  table_id: number | null;
  table_name: string | null;
  game_id: string | null;
  common_hand_id: string | null;
  reserved_buy_in_amount: number | null;
  wallet_before_queue: number | null;
  wallet_after_queue: number | null;
  wallet_after_promotion: number | null;
  queue_position_before_promotion: number | null;
  promoted_table_id: number | null;
  promoted_seat_number: number | null;
  promotion_observed_at: string | null;
  active_seat_observed_at: string | null;
  banner_observed_at: string | null;
  action_timeout_seconds: number | null;
  reconnect_grace_ms_expected: number | null;
  active_seat_inactive_deadline_ms: number | null;
  disruption: DisruptionSummary | null;
  seat_state_before: SeatSnapshot | null;
  seat_state_after: SeatSnapshot | null;
  page_a_url: string | null;
  page_b_url: string | null;
  page_a_actionable: boolean | null;
  page_b_actionable: boolean | null;
  page_a_connection_state: string | null;
  page_b_connection_state: string | null;
  reconnecting_overlay_observed_page_a: boolean;
  reconnecting_overlay_observed_page_b: boolean;
  last_observed_banner: string | null;
  last_socket_error_code: string | null;
  cleanup: CleanupSummary;
  phase_timings: Record<string, number>;
}

export class FixtureConflictError extends Error {}

export class SummaryTracker {
  private readonly summary: FullStackSummary;
  private readonly artifactDir: string;
  private currentPhase: string | null = null;
  private phaseStartedAt: number | null = null;

  constructor(
    artifactDir: string,
    scenario: string,
    mode: FullStackSummary['mode'] = 'compose-browser-e2e',
  ) {
    this.artifactDir = artifactDir;
    this.summary = {
      mode,
      required_check: mode === 'compose-browser-pr-smoke',
      scenario,
      phase: 'starting',
      status: 'running',
      error: null,
      run_tag: null,
      fixture_create_dispatched: false,
      fixture_create_succeeded: false,
      auto_seat_players: false,
      league_id: null,
      league_name: null,
      community_id: null,
      community_name: null,
      table_id: null,
      table_name: null,
      game_id: null,
      common_hand_id: null,
      reserved_buy_in_amount: null,
      wallet_before_queue: null,
      wallet_after_queue: null,
      wallet_after_promotion: null,
      queue_position_before_promotion: null,
      promoted_table_id: null,
      promoted_seat_number: null,
      promotion_observed_at: null,
      active_seat_observed_at: null,
      banner_observed_at: null,
      action_timeout_seconds: null,
      reconnect_grace_ms_expected: null,
      active_seat_inactive_deadline_ms: null,
      disruption: null,
      seat_state_before: null,
      seat_state_after: null,
      page_a_url: null,
      page_b_url: null,
      page_a_actionable: null,
      page_b_actionable: null,
      page_a_connection_state: null,
      page_b_connection_state: null,
      reconnecting_overlay_observed_page_a: false,
      reconnecting_overlay_observed_page_b: false,
      last_observed_banner: null,
      last_socket_error_code: null,
      cleanup: {
        attempted: false,
        succeeded: false,
      },
      phase_timings: {},
    };
  }

  async update(patch: Partial<FullStackSummary>): Promise<void> {
    Object.assign(this.summary, patch);
    await this.write();
  }

  async markPhase(phase: string): Promise<void> {
    const now = Date.now();
    if (this.currentPhase && this.phaseStartedAt !== null) {
      this.summary.phase_timings[this.currentPhase] = Number(((now - this.phaseStartedAt) / 1000).toFixed(3));
    }
    this.currentPhase = phase;
    this.phaseStartedAt = now;
    this.summary.phase = phase;
    await this.write();
  }

  async finalize(status: 'passed' | 'failed', error: string | null = null): Promise<void> {
    if (this.currentPhase && this.phaseStartedAt !== null) {
      const now = Date.now();
      this.summary.phase_timings[this.currentPhase] = Number(((now - this.phaseStartedAt) / 1000).toFixed(3));
      this.currentPhase = null;
      this.phaseStartedAt = null;
    }
    this.summary.status = status;
    this.summary.error = error;
    if (status === 'passed') {
      this.summary.phase = 'done';
    }
    await this.write();
  }

  get runTag(): string | null {
    return this.summary.run_tag;
  }

  async write(): Promise<void> {
    await mkdir(this.artifactDir, { recursive: true });
    const summaryPath = join(this.artifactDir, 'summary.json');
    const tmpPath = `${summaryPath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(redactSecrets(this.summary), null, 2), 'utf-8');
    await rename(tmpPath, summaryPath);
  }
}

export const redactSecrets = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
      if (SECRET_KEYS.has(key.toLowerCase())) {
        return [key, '<redacted>'];
      }
      return [key, redactSecrets(entryValue)];
    });
    return Object.fromEntries(entries);
  }
  return value;
};

const safeBodyText = async (response: { text(): Promise<string> }): Promise<string> => {
  const text = await response.text();
  try {
    return JSON.stringify(redactSecrets(JSON.parse(text)));
  } catch {
    return text;
  }
};

const assertOk = async (response: { ok(): boolean; status(): number; statusText(): string; text(): Promise<string> }, context: string) => {
  if (response.ok()) {
    return;
  }
  const body = await safeBodyText(response);
  throw new Error(`${context} failed with ${response.status()} ${response.statusText()}: ${body}`);
};

const authHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});

export const generateRunTag = (scenario?: string): string => {
  const githubRunId = process.env.GITHUB_RUN_ID;
  const githubRunAttempt = process.env.GITHUB_RUN_ATTEMPT;
  const scenarioFragment = scenario ? slugifyScenario(scenario).slice(0, 40) : '';
  if (githubRunId && githubRunAttempt) {
    const base = `e2e-browser-gh-${githubRunId}-${githubRunAttempt}`;
    if (!scenarioFragment) {
      return base;
    }
    return `${base}-${scenarioFragment}`.slice(0, 128);
  }
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  if (!scenarioFragment) {
    return `e2e-browser-${timestamp}-${randomBytes(3).toString('hex')}`;
  }
  return `e2e-browser-${timestamp}-${scenarioFragment}-${randomBytes(2).toString('hex')}`.slice(0, 128);
};

export const validateRunTag = (runTag: string): string => {
  const normalized = runTag.trim();
  if (!RUN_TAG_PATTERN.test(normalized)) {
    throw new Error(`Invalid run tag: ${runTag}`);
  }
  return normalized;
};

export const slugifyScenario = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
};

export const createScenarioArtifactDir = (rootDir: string, scenario: string): string => {
  return join(rootDir, slugifyScenario(scenario));
};

export const createApiContext = async (baseURL: string, token?: string): Promise<APIRequestContext> => {
  return playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: token ? authHeaders(token) : undefined,
  });
};

export const loginApi = async (
  authApiUrl: string,
  username: string,
  password: string,
): Promise<{ token: string; userId: number }> => {
  const ctx = await createApiContext(authApiUrl);
  try {
    const response = await ctx.post('/auth/login', {
      params: { username, password },
    });
    await assertOk(response, `API login for ${username}`);
    const payload = await response.json();
    if (payload.requires_2fa) {
      throw new Error(`Login for ${username} unexpectedly requires admin 2FA`);
    }
    if (!payload.access_token) {
      throw new Error(`Login for ${username} did not return access_token`);
    }
    const userId = Number(payload.user?.id);
    if (!Number.isFinite(userId)) {
      throw new Error(`Login for ${username} did not return a valid user id`);
    }
    return { token: String(payload.access_token), userId };
  } finally {
    await ctx.dispose();
  }
};

export const createAuthenticatedApiUser = async (
  authApiUrl: string,
  user: FixtureUserCredential,
): Promise<AuthenticatedApiUser> => {
  const { token, userId } = await loginApi(authApiUrl, user.username, user.password);
  return {
    username: user.username,
    password: user.password,
    userId,
    token,
    request: await createApiContext(authApiUrl, token),
  };
};

export const assertHealth = async (baseURL: string, label: string): Promise<void> => {
  const ctx = await createApiContext(baseURL);
  try {
    const response = await ctx.get('/health');
    await assertOk(response, `${label} health`);
  } finally {
    await ctx.dispose();
  }
};

export const createFixture = async (
  adminRequest: APIRequestContext,
  runTag: string,
  options: FixtureCreateOptions = {},
): Promise<GameplayFixture> => {
  const {
    autoSeatPlayers = false,
    actionTimeoutSeconds = 60,
    playerCount = 2,
    queuedPlayerCount = 0,
    startingBalance = '1000.00',
    buyIn = 200,
    smallBlind = 10,
    bigBlind = 20,
    maxSeats = 2,
    maxQueueSize = 0,
  } = options;

  const response = await adminRequest.post('/api/admin/test-fixtures/gameplay-stack', {
    data: {
      run_tag: runTag,
      player_count: playerCount,
      queued_player_count: queuedPlayerCount,
      auto_seat_players: autoSeatPlayers,
      starting_balance: startingBalance,
      buy_in: buyIn,
      small_blind: smallBlind,
      big_blind: bigBlind,
      max_seats: maxSeats,
      max_queue_size: maxQueueSize,
      action_timeout_seconds: actionTimeoutSeconds,
    },
  });

  if (response.status() === 409) {
    throw new FixtureConflictError(`Fixture run tag already exists: ${runTag}`);
  }

  await assertOk(response, `Fixture create ${runTag}`);
  return (await response.json()) as GameplayFixture;
};

export const cleanupFixture = async (
  adminRequest: APIRequestContext,
  runTag: string,
): Promise<{ status: string; deleted: Record<string, number> }> => {
  const response = await adminRequest.delete(`/api/admin/test-fixtures/runs/${runTag}`);
  await assertOk(response, `Fixture cleanup ${runTag}`);
  return await response.json();
};

export const seedReturningVisitor = async (context: BrowserContext, baseURL: string): Promise<void> => {
  // The full-stack gameplay test intentionally bypasses first-visit onboarding.
  // Onboarding has separate coverage; this test starts at real login.
  await context.addCookies([
    {
      name: 'dormstacks_seen',
      value: '1',
      url: baseURL,
    },
  ]);
};

export const loginViaUi = async (page: Page, username: string, password: string): Promise<void> => {
  await page.goto('/login');
  await expect(page.getByTestId('login-username-input')).toBeVisible();
  await page.getByTestId('login-username-input').fill(username);
  await page.getByTestId('login-password-input').fill(password);
  await page.getByTestId('login-submit-button').click();
  await expect(page).toHaveURL(/\/dashboard$/);
};

export const getTableSeats = async (userRequest: APIRequestContext, tableId: number): Promise<Array<Record<string, unknown>>> => {
  const response = await userRequest.get(`/api/tables/${tableId}/seats`);
  await assertOk(response, `Load table seats ${tableId}`);
  return (await response.json()) as Array<Record<string, unknown>>;
};

export const getActiveSeatStatus = async (userRequest: APIRequestContext): Promise<Record<string, unknown>> => {
  const response = await userRequest.get('/api/tables/me/active-seat');
  await assertOk(response, 'Load active seat');
  return (await response.json()) as Record<string, unknown>;
};

export const getCommunityTables = async (
  userRequest: APIRequestContext,
  communityId: number,
): Promise<Array<Record<string, unknown>>> => {
  const response = await userRequest.get(`/api/communities/${communityId}/tables`);
  await assertOk(response, `Load community tables ${communityId}`);
  return (await response.json()) as Array<Record<string, unknown>>;
};

export const getWalletBalance = async (
  userRequest: APIRequestContext,
  communityId: number,
): Promise<number> => {
  const response = await userRequest.get('/api/wallets');
  await assertOk(response, 'Load wallets');
  const wallets = (await response.json()) as Array<Record<string, unknown>>;
  const wallet = wallets.find((entry) => Number(entry.community_id) === communityId);
  if (!wallet) {
    throw new Error(`Wallet for community ${communityId} not found`);
  }
  return Number(wallet.balance);
};

export const getTableQueueEntries = async (
  userRequest: APIRequestContext,
  tableId: number,
): Promise<QueueSnapshot[]> => {
  const response = await userRequest.get(`/api/tables/${tableId}/queue`);
  await assertOk(response, `Load table queue ${tableId}`);
  const payload = (await response.json()) as Array<Record<string, unknown>>;
  return payload.map((entry) => ({
    userId: String(entry.user_id),
    position: Number(entry.position),
    reservedBuyInAmount: entry.reserved_buy_in_amount === undefined || entry.reserved_buy_in_amount === null
      ? null
      : Number(entry.reserved_buy_in_amount),
  }));
};

export const getActiveSessionsForTable = async (
  adminRequest: APIRequestContext,
  tableId: number,
): Promise<Array<Record<string, unknown>>> => {
  const response = await adminRequest.get(`/api/internal/tables/${tableId}/active-sessions`);
  await assertOk(response, `Load active sessions for table ${tableId}`);
  return (await response.json()) as Array<Record<string, unknown>>;
};

export const getCommunityTableSummary = async (
  userRequest: APIRequestContext,
  communityId: number,
  tableId: number,
): Promise<Record<string, unknown>> => {
  const tables = await getCommunityTables(userRequest, communityId);
  const table = tables.find((entry) => Number(entry.id) === tableId);
  if (!table) {
    throw new Error(`Table ${tableId} not found in community summary ${communityId}`);
  }
  return table;
};

export const waitForSeatAssignment = async (
  userRequest: APIRequestContext,
  tableId: number,
  expectedAssignments: Record<number, number>,
): Promise<void> => {
  await expect.poll(async () => {
    const seats = await getTableSeats(userRequest, tableId);
    return Object.entries(expectedAssignments).every(([seatNumber, userId]) => {
      const seat = seats.find((entry) => Number(entry.seat_number) === Number(seatNumber));
      return Number(seat?.user_id) === Number(userId);
    });
  }, {
    timeout: 15_000,
    intervals: [250, 500, 1000],
  }).toBe(true);
};

export const createBrowserContext = async (
  browser: Browser,
  baseUrl: string,
  viewport = { width: 1366, height: 768 },
): Promise<{ context: BrowserContext; page: Page }> => {
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport,
  });
  await seedReturningVisitor(context, baseUrl);
  const page = await context.newPage();
  return { context, page };
};

export const joinSeat = async (
  page: Page,
  fixture: { community_id: number; table_id: number; table_name: string },
  seatNumber: number,
): Promise<void> => {
  await expect(locatorByDataValue(page, 'lobby-table-row', 'data-table-id', fixture.table_id)).toContainText(fixture.table_name);
  await locatorByDataValue(page, 'join-table-button', 'data-table-id', fixture.table_id).click();
  await expect(page.getByText(`Join ${fixture.table_name}`)).toBeVisible();
  await locatorByDataValue(page, 'seat-button', 'data-seat-number', seatNumber).click();
  await page.getByTestId('confirm-join-button').click();
  await expect(page).toHaveURL(new RegExp(`/game/${fixture.table_id}\\?communityId=${fixture.community_id}$`));
};

export const joinQueueFromLobby = async (
  page: Page,
  fixture: { table_id: number },
  buyInAmount: number,
): Promise<void> => {
  await locatorByDataValue(page, 'join-queue-button', 'data-table-id', fixture.table_id).click();
  await expect(page.getByTestId('confirm-queue-button')).toBeVisible();
  await page.getByTestId('queue-buy-in-input').fill(String(buyInAmount));
  await page.getByTestId('confirm-queue-button').click();
};

export const isAcceptablePersistedHand = (
  detail: Record<string, unknown>,
  fixture: GameplayFixture,
  expectedUserIds: number[],
): boolean => {
  if (Number(detail.table_id) !== fixture.table_id) {
    return false;
  }
  const handData = (detail.hand_data ?? {}) as Record<string, unknown>;
  const actionLog = Array.isArray(handData.action_log) ? handData.action_log : [];
  if (actionLog.length === 0) {
    return false;
  }
  const players = Array.isArray(handData.players) ? handData.players : [];
  const presentUserIds = new Set(
    players
      .map((player) => Number((player as Record<string, unknown>).user_id))
      .filter((value) => Number.isFinite(value)),
  );
  return expectedUserIds.every((userId) => presentUserIds.has(userId));
};

export const findCommonPersistedHand = async (
  userA: AuthenticatedApiUser,
  userB: AuthenticatedApiUser,
  fixture: GameplayFixture,
): Promise<{ handId: string; detail: Record<string, unknown> } | null> => {
  const expectedUserIds = [userA.userId, userB.userId];
  const [handsAResponse, handsBResponse] = await Promise.all([
    userA.request.get('/api/me/hands', { params: { limit: 50, offset: 0 } }),
    userB.request.get('/api/me/hands', { params: { limit: 50, offset: 0 } }),
  ]);
  await assertOk(handsAResponse, `Load hands for ${userA.username}`);
  await assertOk(handsBResponse, `Load hands for ${userB.username}`);
  const handsA = (await handsAResponse.json()) as Array<Record<string, unknown>>;
  const handsB = (await handsBResponse.json()) as Array<Record<string, unknown>>;
  const commonIds = new Set(
    handsA.map((hand) => String(hand.id)).filter((id) => handsB.some((other) => String(other.id) === id)),
  );
  for (const handId of commonIds) {
    const [detailAResponse, detailBResponse] = await Promise.all([
      userA.request.get(`/api/hands/${handId}`),
      userB.request.get(`/api/hands/${handId}`),
    ]);
    if (!detailAResponse.ok() || !detailBResponse.ok()) {
      continue;
    }
    const detailA = (await detailAResponse.json()) as Record<string, unknown>;
    const detailB = (await detailBResponse.json()) as Record<string, unknown>;
    if (isAcceptablePersistedHand(detailA, fixture, expectedUserIds) && isAcceptablePersistedHand(detailB, fixture, expectedUserIds)) {
      return { handId, detail: detailA };
    }
  }
  return null;
};

export const waitForCommonPersistedHand = async (
  userA: AuthenticatedApiUser,
  userB: AuthenticatedApiUser,
  fixture: GameplayFixture,
): Promise<{ handId: string; detail: Record<string, unknown> }> => {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const result = await findCommonPersistedHand(userA, userB, fixture);
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error('Timed out waiting for a common persisted hand');
};

export const assertOnGameRoute = async (page: Page, fixture: Pick<GameplayFixture, 'table_id' | 'community_id'>): Promise<void> => {
  await expect(page).toHaveURL(new RegExp(`/game/${fixture.table_id}\\?communityId=${fixture.community_id}$`));
};

export const waitForGameTable = async (page: Page, timeout = 20_000): Promise<void> => {
  await expect(page.getByTestId('game-table')).toBeVisible({ timeout });
};

export const assertUiSeatAssignments = async (
  pageA: Page,
  pageB: Page,
  assignments: Record<number, string>,
): Promise<void> => {
  for (const [seatNumber, username] of Object.entries(assignments)) {
    await expect(locatorByDataValue(pageA, 'seat-player-name', 'data-seat-number', seatNumber)).toHaveText(username);
    await expect(locatorByDataValue(pageB, 'seat-player-name', 'data-seat-number', seatNumber)).toHaveText(username);
  }
};

export const awaitActionable = async (page: Page, timeout = 45_000): Promise<Array<'check' | 'call' | 'fold'>> => {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    await waitForGameTable(page, 5_000);
    const actions = await getEnabledActions(page);
    if (actions.length > 0) {
      return actions;
    }
    await page.waitForTimeout(200);
  }

  throw new Error(`Timed out waiting for actionable state on ${page.url()}`);
};

export const awaitHealthyNonActionable = async (
  page: Page,
  fixture: Pick<GameplayFixture, 'table_id' | 'community_id'>,
  timeout = 45_000,
): Promise<void> => {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const onExpectedRoute = page.url().includes(`/game/${fixture.table_id}?communityId=${fixture.community_id}`);
    if (!onExpectedRoute) {
      await page.waitForTimeout(200);
      continue;
    }

    const [gameTableVisible, reconnectingVisible, actions] = await Promise.all([
      page.getByTestId('game-table').isVisible().catch(() => false),
      page.getByTestId('reconnecting-overlay').isVisible().catch(() => false),
      getEnabledActions(page),
    ]);

    if (gameTableVisible && !reconnectingVisible && actions.length === 0) {
      return;
    }

    await page.waitForTimeout(200);
  }

  throw new Error(`Timed out waiting for healthy non-actionable state on ${page.url()}`);
};

export const awaitActionabilityPair = async (
  actionablePage: Page,
  passivePage: Page,
  fixture: Pick<GameplayFixture, 'table_id' | 'community_id'>,
  timeout = 45_000,
): Promise<Array<'check' | 'call' | 'fold'>> => {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const [actionableActions, passiveActions, passiveGameVisible, passiveReconnect] = await Promise.all([
      getEnabledActions(actionablePage),
      getEnabledActions(passivePage),
      passivePage.getByTestId('game-table').isVisible().catch(() => false),
      passivePage.getByTestId('reconnecting-overlay').isVisible().catch(() => false),
    ]);

    const passiveOnExpectedRoute = passivePage.url().includes(`/game/${fixture.table_id}?communityId=${fixture.community_id}`);
    if (
      actionableActions.length > 0
      && passiveActions.length === 0
      && passiveOnExpectedRoute
      && passiveGameVisible
      && !passiveReconnect
    ) {
      return actionableActions;
    }

    await actionablePage.waitForTimeout(200);
  }

  throw new Error(`Timed out waiting for actionability pair: actionable=${actionablePage.url()} passive=${passivePage.url()}`);
};

export const awaitReconnectingOverlay = async (page: Page, timeout = 10_000): Promise<void> => {
  await expect(page.getByTestId('reconnecting-overlay')).toBeVisible({ timeout });
};

export const awaitImmediateLeaveAvailable = async (page: Page, timeout = 15_000): Promise<void> => {
  const leaveButton = page.getByTestId('leave-game-button').first();
  await expect(leaveButton).toBeVisible({ timeout });
  await expect(leaveButton).toBeEnabled({ timeout });
};

export const locatorByDataValue = (page: Page, testId: string, attributeName: string, attributeValue: string | number) => {
  return page.locator(`[data-testid="${testId}"][${attributeName}="${attributeValue}"]`);
};

export const getEnabledActions = async (page: Page): Promise<Array<'check' | 'call' | 'fold'>> => {
  return page.evaluate(() => {
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
        && element.getClientRects().length > 0;
    };

    const actionPanel = document.querySelector('[data-testid="action-panel"]');
    if (!isVisible(actionPanel)) {
      return [] as Array<'check' | 'call' | 'fold'>;
    }

    const states: Array<{ name: 'check' | 'call' | 'fold'; testId: string }> = [
      { name: 'check', testId: 'action-check-button' },
      { name: 'call', testId: 'action-call-button' },
      { name: 'fold', testId: 'action-fold-button' },
    ];

    const enabled: Array<'check' | 'call' | 'fold'> = [];
    for (const state of states) {
      const button = document.querySelector(`[data-testid="${state.testId}"]`);
      if (!(button instanceof HTMLButtonElement) || !isVisible(button) || button.disabled) {
        continue;
      }
      enabled.push(state.name);
    }

    return enabled;
  });
};

export const clickHighestPriorityAction = async (page: Page): Promise<'check' | 'call' | 'fold'> => {
  const enabledActions = await getEnabledActions(page);
  if (enabledActions.includes('check')) {
    await page.getByTestId('action-check-button').click();
    return 'check';
  }
  if (enabledActions.includes('call')) {
    await page.getByTestId('action-call-button').click();
    return 'call';
  }
  if (enabledActions.includes('fold')) {
    await page.getByTestId('action-fold-button').click();
    return 'fold';
  }
  throw new Error('No enabled actions available to click');
};

export const waitForActionStateChange = async (page: Page, previousActions: Array<'check' | 'call' | 'fold'>): Promise<void> => {
  const previousKey = previousActions.join(',');
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const nextKey = (await getEnabledActions(page)).join(',');
    if (nextKey !== previousKey) {
      return;
    }
    await page.waitForTimeout(150);
  }
};

export const summarizeSeatAssignments = (seats: Array<Record<string, unknown>>): Record<number, number | null> => {
  return Object.fromEntries(
    seats.map((seat) => [
      Number(seat.seat_number),
      seat.user_id === null || seat.user_id === undefined ? null : Number(seat.user_id),
    ]),
  );
};

const normalizeSnapshotId = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

export const captureSeatSnapshot = async (
  userA: AuthenticatedApiUser,
  userB: AuthenticatedApiUser,
  tableId: number,
): Promise<SeatSnapshot> => {
  const [seats, activeSeatA, activeSeatB] = await Promise.all([
    getTableSeats(userA.request, tableId),
    getActiveSeatStatus(userA.request),
    getActiveSeatStatus(userB.request),
  ]);

  const findSeatForUser = (userId: number): number | null => {
    const seat = seats.find((entry) => Number(entry.user_id) === userId);
    return seat ? Number(seat.seat_number) : null;
  };

  return {
    tableId: String(tableId),
    userA: {
      userId: String(userA.userId),
      seatNumber: findSeatForUser(userA.userId),
      activeSeatTableId: normalizeSnapshotId(activeSeatA.table_id),
      activeSeatNumber: activeSeatA.seat_number === undefined || activeSeatA.seat_number === null ? null : Number(activeSeatA.seat_number),
    },
    userB: {
      userId: String(userB.userId),
      seatNumber: findSeatForUser(userB.userId),
      activeSeatTableId: normalizeSnapshotId(activeSeatB.table_id),
      activeSeatNumber: activeSeatB.seat_number === undefined || activeSeatB.seat_number === null ? null : Number(activeSeatB.seat_number),
    },
    seats: seats
      .filter((entry) => entry.user_id !== null && entry.user_id !== undefined)
      .map((entry) => ({
        userId: String(entry.user_id),
        seatNumber: Number(entry.seat_number),
      }))
      .sort((left, right) => left.seatNumber - right.seatNumber),
  };
};

export const assertSeatSnapshot = (
  snapshot: SeatSnapshot,
  expected: {
    tableId: number | string;
    userAId: number | string;
    userBId: number | string;
    userASeatNumber: number | null;
    userBSeatNumber: number | null;
  },
): void => {
  expect(snapshot.tableId).toBe(String(expected.tableId));
  expect(snapshot.userA.userId).toBe(String(expected.userAId));
  expect(snapshot.userB.userId).toBe(String(expected.userBId));
  expect(snapshot.userA.seatNumber).toBe(expected.userASeatNumber);
  expect(snapshot.userB.seatNumber).toBe(expected.userBSeatNumber);
};

export const assertNoSeatDrift = (before: SeatSnapshot, after: SeatSnapshot): void => {
  expect(after.tableId).toBe(before.tableId);
  expect(after.userA.userId).toBe(before.userA.userId);
  expect(after.userB.userId).toBe(before.userB.userId);
  expect(after.userA.seatNumber).toBe(before.userA.seatNumber);
  expect(after.userB.seatNumber).toBe(before.userB.seatNumber);
  expect(after.userA.activeSeatTableId).toBe(before.userA.activeSeatTableId);
  expect(after.userB.activeSeatTableId).toBe(before.userB.activeSeatTableId);
  expect(after.userA.activeSeatNumber).toBe(before.userA.activeSeatNumber);
  expect(after.userB.activeSeatNumber).toBe(before.userB.activeSeatNumber);

  const seatKeys = after.seats.map((entry) => `${entry.userId}:${entry.seatNumber}`);
  expect(new Set(seatKeys).size).toBe(seatKeys.length);
  expect(after.seats).toEqual(before.seats);
};

export const assertUserNotOccupyingSeat = async (
  page: Page,
  username: string,
  seatNumber: number,
): Promise<void> => {
  const locator = locatorByDataValue(page, 'seat-player-name', 'data-seat-number', seatNumber);
  const count = await locator.count();
  if (count === 0) {
    return;
  }
  const text = (await locator.first().textContent())?.trim() ?? '';
  expect(text).not.toBe(username);
};

export const getConnectionState = async (page: Page): Promise<string> => {
  if (await page.getByTestId('reconnecting-overlay').isVisible().catch(() => false)) {
    return 'reconnecting';
  }
  if (await page.getByTestId('game-table').isVisible().catch(() => false)) {
    return 'connected';
  }
  return 'unknown';
};

export const readVisibleBannerText = async (page: Page, selector: string): Promise<string | null> => {
  return page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!(element instanceof HTMLElement)) {
      return null;
    }
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || element.getClientRects().length === 0) {
      return null;
    }
    const text = element.textContent?.trim() ?? '';
    return text || null;
  }, selector);
};

export const describePageState = async (page: Page, name: string) => {
  const [actions, seatLostBanner, errorBanner, bustedBanner, reconnectingVisible, connectionState] = await Promise.all([
    getEnabledActions(page),
    readVisibleBannerText(page, '[data-testid="seat-lost-banner"]').catch(() => null),
    readVisibleBannerText(page, '.error-banner').catch(() => null),
    readVisibleBannerText(page, '.busted-banner').catch(() => null),
    page.getByTestId('reconnecting-overlay').isVisible().catch(() => false),
    getConnectionState(page),
  ]);

  return {
    name,
    url: page.url(),
    actions,
    seatLostBanner,
    errorBanner,
    bustedBanner,
    reconnectingVisible,
    connectionState,
  };
};

export const assertGameplayStillHealthy = async (
  fixture: GameplayFixture,
  pageA: Page,
  pageB: Page,
  userAApi: AuthenticatedApiUser,
  userBApi: AuthenticatedApiUser,
): Promise<void> => {
  const expectedGameUrl = `/game/${fixture.table_id}?communityId=${fixture.community_id}`;
  const pageDiagnostics = await Promise.all([
    describePageState(pageA, fixture.users[0].username),
    describePageState(pageB, fixture.users[1].username),
  ]);

  for (const diagnostic of pageDiagnostics) {
    if (!diagnostic.url.includes(expectedGameUrl)) {
      throw new Error(`Gameplay state lost: ${JSON.stringify(pageDiagnostics)}`);
    }
    if (diagnostic.bustedBanner || (diagnostic.errorBanner && /timed out|removed from the table/i.test(diagnostic.errorBanner))) {
      throw new Error(`Gameplay state unhealthy: ${JSON.stringify(pageDiagnostics)}`);
    }
  }

  const seats = await getTableSeats(userAApi.request, fixture.table_id);
  const seatSummary = summarizeSeatAssignments(seats);
  if (seatSummary[1] !== userAApi.userId || seatSummary[2] !== userBApi.userId) {
    throw new Error(`Seat assignments changed during gameplay: ${JSON.stringify({ seatSummary, pageDiagnostics })}`);
  }
};

export class GameplayCoordinator {
  private paused = false;
  private inFlight = false;

  constructor(
    private readonly pageA: Page,
    private readonly pageB: Page,
    private readonly userAApi: AuthenticatedApiUser,
    private readonly userBApi: AuthenticatedApiUser,
    private readonly fixture: GameplayFixture,
    private readonly summary?: SummaryTracker,
  ) {}

  async pauseAndDrain(): Promise<void> {
    this.paused = true;
    while (this.inFlight) {
      await this.pageA.waitForTimeout(50);
    }
  }

  resume(): void {
    this.paused = false;
  }

  async captureDiagnostics(): Promise<void> {
    const [pageAState, pageBState] = await Promise.all([
      describePageState(this.pageA, this.fixture.users[0].username),
      describePageState(this.pageB, this.fixture.users[1].username),
    ]);
    await this.summary?.update({
      page_a_url: pageAState.url,
      page_b_url: pageBState.url,
      page_a_actionable: pageAState.actions.length > 0,
      page_b_actionable: pageBState.actions.length > 0,
      page_a_connection_state: pageAState.connectionState,
      page_b_connection_state: pageBState.connectionState,
      reconnecting_overlay_observed_page_a: pageAState.reconnectingVisible,
      reconnecting_overlay_observed_page_b: pageBState.reconnectingVisible,
      last_observed_banner: pageAState.seatLostBanner ?? pageBState.seatLostBanner ?? null,
    });
  }

  async playUntilPersistedHand(options: {
    deadlineMs: number;
    idleFailureMs?: number;
    healthCheckIntervalMs?: number;
  }): Promise<{ handId: string; detail: Record<string, unknown> }> {
    const deadlineAt = Date.now() + options.deadlineMs;
    const idleFailureMs = options.idleFailureMs ?? 20_000;
    const healthCheckIntervalMs = options.healthCheckIntervalMs ?? 5_000;
    let lastProgressAt = Date.now();
    let lastHealthCheckAt = 0;

    while (Date.now() < deadlineAt) {
      if (this.paused) {
        await this.pageA.waitForTimeout(100);
        continue;
      }

      const persistedHand = await findCommonPersistedHand(this.userAApi, this.userBApi, this.fixture);
      if (persistedHand) {
        await this.summary?.update({ common_hand_id: persistedHand.handId });
        return persistedHand;
      }

      const [actionsA, actionsB] = await Promise.all([
        getEnabledActions(this.pageA),
        getEnabledActions(this.pageB),
      ]);

      const actionablePages = [
        { page: this.pageA, actions: actionsA },
        { page: this.pageB, actions: actionsB },
      ].filter((entry) => entry.actions.length > 0);

      if (actionablePages.length > 1) {
        const diagnostics = await Promise.all([
          describePageState(this.pageA, this.fixture.users[0].username),
          describePageState(this.pageB, this.fixture.users[1].username),
        ]);
        throw new Error(`Both pages appeared actionable at once: ${JSON.stringify(diagnostics)}`);
      }

      if (actionablePages.length === 1) {
        this.inFlight = true;
        try {
          const activePage = actionablePages[0];
          await clickHighestPriorityAction(activePage.page);
          await waitForActionStateChange(activePage.page, activePage.actions);
          lastProgressAt = Date.now();
          await this.captureDiagnostics();
        } finally {
          this.inFlight = false;
        }
      } else {
        await this.pageA.waitForTimeout(250);
      }

      if (Date.now() - lastProgressAt > idleFailureMs) {
        await this.captureDiagnostics();
        throw new Error(`Gameplay coordinator made no progress for ${idleFailureMs}ms`);
      }

      if (Date.now() - lastHealthCheckAt > healthCheckIntervalMs) {
        await assertGameplayStillHealthy(this.fixture, this.pageA, this.pageB, this.userAApi, this.userBApi);
        lastHealthCheckAt = Date.now();
      }
    }

    await this.captureDiagnostics();
    throw new Error('Timed out waiting for a persisted common hand');
  }
}

export const disposeApiUsers = async (...users: Array<AuthenticatedApiUser | null | undefined>): Promise<void> => {
  for (const user of users) {
    if (!user) {
      continue;
    }
    await user.request.dispose();
  }
};
