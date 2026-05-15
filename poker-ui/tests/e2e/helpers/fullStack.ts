import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
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

export interface AuthenticatedApiUser {
  username: string;
  password: string;
  userId: number;
  token: string;
  request: APIRequestContext;
}

interface CleanupSummary {
  attempted: boolean;
  succeeded: boolean;
  status?: string | null;
  deleted?: Record<string, number>;
  error?: string | null;
}

interface FullStackSummary {
  mode: 'compose-browser-e2e';
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
  cleanup: CleanupSummary;
  phase_timings: Record<string, number>;
}

export class FixtureConflictError extends Error {}

export class SummaryTracker {
  private readonly summary: FullStackSummary;
  private readonly artifactDir: string;
  private currentPhase: string | null = null;
  private phaseStartedAt: number | null = null;

  constructor(artifactDir: string) {
    this.artifactDir = artifactDir;
    this.summary = {
      mode: 'compose-browser-e2e',
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

export const generateRunTag = (): string => {
  const githubRunId = process.env.GITHUB_RUN_ID;
  const githubRunAttempt = process.env.GITHUB_RUN_ATTEMPT;
  if (githubRunId && githubRunAttempt) {
    return `e2e-browser-gh-${githubRunId}-${githubRunAttempt}`;
  }
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `e2e-browser-${timestamp}-${randomBytes(3).toString('hex')}`;
};

export const validateRunTag = (runTag: string): string => {
  const normalized = runTag.trim();
  if (!RUN_TAG_PATTERN.test(normalized)) {
    throw new Error(`Invalid run tag: ${runTag}`);
  }
  return normalized;
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
): Promise<GameplayFixture> => {
  const response = await adminRequest.post('/api/admin/test-fixtures/gameplay-stack', {
    data: {
      run_tag: runTag,
      player_count: 2,
      queued_player_count: 0,
      auto_seat_players: false,
      starting_balance: '1000.00',
      buy_in: 200,
      small_blind: 10,
      big_blind: 20,
      max_seats: 2,
      max_queue_size: 0,
      action_timeout_seconds: 30,
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

export const locatorByDataValue = (page: Page, testId: string, attributeName: string, attributeValue: string | number) => {
  return page.locator(`[data-testid="${testId}"][${attributeName}="${attributeValue}"]`);
};

export const getEnabledActions = async (page: Page): Promise<Array<'check' | 'call' | 'fold'>> => {
  const actionPanel = page.getByTestId('action-panel');
  if (await actionPanel.count() === 0 || !(await actionPanel.first().isVisible())) {
    return [];
  }

  const states: Array<{ name: 'check' | 'call' | 'fold'; testId: string }> = [
    { name: 'check', testId: 'action-check-button' },
    { name: 'call', testId: 'action-call-button' },
    { name: 'fold', testId: 'action-fold-button' },
  ];

  const enabled: Array<'check' | 'call' | 'fold'> = [];
  for (const state of states) {
    const locator = page.getByTestId(state.testId);
    if (await locator.count() === 0) {
      continue;
    }
    if ((await locator.isVisible()) && (await locator.isEnabled())) {
      enabled.push(state.name);
    }
  }
  return enabled;
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

export const disposeApiUsers = async (...users: Array<AuthenticatedApiUser | null | undefined>): Promise<void> => {
  for (const user of users) {
    if (!user) {
      continue;
    }
    await user.request.dispose();
  }
};
