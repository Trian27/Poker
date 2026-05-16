import {
  test as base,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  type AuthenticatedApiUser,
  type FixtureCreateOptions,
  type GameplayFixture,
  SummaryTracker,
  FixtureConflictError,
  assertHealth,
  cleanupFixture,
  createApiContext,
  createAuthenticatedApiUser,
  createBrowserContext,
  createFixture,
  createScenarioArtifactDir,
  disposeApiUsers,
  generateRunTag,
  loginApi,
  loginViaUi,
  validateRunTag,
} from '../helpers/fullStack';

export const FULL_STACK_ENABLED = process.env.PLAYWRIGHT_FULL_STACK === '1';
export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL;
export const AUTH_API_URL = process.env.PLAYWRIGHT_AUTH_API_URL;
export const GAME_SERVER_URL = process.env.PLAYWRIGHT_GAME_SERVER_URL;
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
export const ARTIFACT_ROOT_DIR = process.env.PLAYWRIGHT_ARTIFACT_DIR || 'test-results/browser-full-stack';
export const BROWSER_VIEWPORT = { width: 1366, height: 768 };
const CLEANUP_TIMEOUT_MS = 60_000;

const requiredEnv = {
  PLAYWRIGHT_BASE_URL: BASE_URL,
  PLAYWRIGHT_AUTH_API_URL: AUTH_API_URL,
  PLAYWRIGHT_GAME_SERVER_URL: GAME_SERVER_URL,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export class FullStackRuntime {
  readonly scenario: string;
  readonly artifactDir: string;
  readonly summary: SummaryTracker;
  readonly runTag: string;
  readonly baseUrl: string;
  readonly authApiUrl: string;
  readonly gameServerUrl: string;
  readonly adminUsername: string;
  readonly adminPassword: string;

  adminApi: APIRequestContext | null = null;
  fixture: GameplayFixture | null = null;
  userAApi: AuthenticatedApiUser | null = null;
  userBApi: AuthenticatedApiUser | null = null;
  pageAContext: BrowserContext | null = null;
  pageBContext: BrowserContext | null = null;
  pageA: Page | null = null;
  pageB: Page | null = null;
  fixtureCreateDispatched = false;
  cleanupSkippedByConflict = false;
  private cleanupDone = false;
  private preflightDone = false;

  constructor(private readonly browser: Browser, scenario: string) {
    this.scenario = scenario;
    this.artifactDir = createScenarioArtifactDir(ARTIFACT_ROOT_DIR, scenario);
    this.summary = new SummaryTracker(this.artifactDir, scenario);
    this.runTag = validateRunTag(generateRunTag(scenario));

    const missingEnv = Object.entries(requiredEnv)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    expect(missingEnv, `Missing required env: ${missingEnv.join(', ')}`).toEqual([]);

    this.baseUrl = BASE_URL!;
    this.authApiUrl = AUTH_API_URL!;
    this.gameServerUrl = GAME_SERVER_URL!;
    this.adminUsername = ADMIN_USERNAME!;
    this.adminPassword = ADMIN_PASSWORD!;
  }

  async initialize(): Promise<void> {
    await this.summary.update({ run_tag: this.runTag, auto_seat_players: false });
  }

  async preflight(): Promise<void> {
    if (this.preflightDone) {
      return;
    }

    await this.summary.markPhase('preflight');
    await Promise.all([
      assertHealth(this.authApiUrl, 'auth-api'),
      assertHealth(this.gameServerUrl, 'game-server'),
    ]);

    const adminLogin = await loginApi(this.authApiUrl, this.adminUsername, this.adminPassword);
    this.adminApi = await createApiContext(this.authApiUrl, adminLogin.token);

    const loginProbeContext = await this.browser.newContext({ baseURL: this.baseUrl, viewport: BROWSER_VIEWPORT });
    try {
      const loginProbePage = await loginProbeContext.newPage();
      await loginProbePage.context().addCookies([
        {
          name: 'dormstacks_seen',
          value: '1',
          url: this.baseUrl,
        },
      ]);
      await loginProbePage.goto('/login');
      await expect(loginProbePage.getByTestId('login-submit-button')).toBeVisible();
    } finally {
      await loginProbeContext.close();
    }

    this.preflightDone = true;
  }

  async provisionFixture(options: FixtureCreateOptions = {}): Promise<GameplayFixture> {
    await this.preflight();
    if (!this.adminApi) {
      throw new Error('Admin API context was not initialized');
    }

    await this.summary.markPhase('fixture_create');
    this.fixtureCreateDispatched = true;
    await this.summary.update({
      fixture_create_dispatched: true,
      action_timeout_seconds: options.actionTimeoutSeconds ?? 60,
    });

    try {
      this.fixture = await createFixture(this.adminApi, this.runTag, options);
    } catch (error) {
      if (error instanceof FixtureConflictError) {
        this.cleanupSkippedByConflict = true;
      }
      throw error;
    }

    await this.summary.update({
      fixture_create_succeeded: true,
      auto_seat_players: this.fixture.auto_seat_players,
      league_id: this.fixture.league_id,
      league_name: this.fixture.league_name,
      community_id: this.fixture.community_id,
      community_name: this.fixture.community_name,
      table_id: this.fixture.table_id,
      table_name: this.fixture.table_name,
      game_id: this.fixture.game_id,
    });

    [this.userAApi, this.userBApi] = await Promise.all([
      createAuthenticatedApiUser(this.authApiUrl, this.fixture.users[0]),
      createAuthenticatedApiUser(this.authApiUrl, this.fixture.users[1]),
    ]);

    return this.fixture;
  }

  async openAndLoginBrowsers(): Promise<{ pageA: Page; pageB: Page }> {
    if (!this.fixture) {
      throw new Error('Fixture must be provisioned before browser login');
    }

    await this.summary.markPhase('browser_login');
    const [{ context: contextA, page: pageA }, { context: contextB, page: pageB }] = await Promise.all([
      createBrowserContext(this.browser, this.baseUrl, BROWSER_VIEWPORT),
      createBrowserContext(this.browser, this.baseUrl, BROWSER_VIEWPORT),
    ]);

    this.pageAContext = contextA;
    this.pageBContext = contextB;
    this.pageA = pageA;
    this.pageB = pageB;

    await loginViaUi(pageA, this.fixture.users[0].username, this.fixture.users[0].password);
    await loginViaUi(pageB, this.fixture.users[1].username, this.fixture.users[1].password);

    return { pageA, pageB };
  }

  async recordFailure(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.summary.update({ error: message, status: 'failed' }).catch(() => undefined);
  }

  async teardown(options: { suppressThrow?: boolean } = {}): Promise<void> {
    if (this.cleanupDone) {
      return;
    }
    this.cleanupDone = true;

    let cleanupError: unknown = null;
    try {
      await this.summary.markPhase('cleanup_started').catch(() => undefined);
      if (this.adminApi && this.fixtureCreateDispatched && !this.cleanupSkippedByConflict) {
        await this.summary.update({
          cleanup: {
            attempted: true,
            succeeded: false,
          },
        }).catch(() => undefined);

        try {
          const cleanupPayload = await withTimeout(
            cleanupFixture(this.adminApi, this.runTag),
            CLEANUP_TIMEOUT_MS,
            `Fixture cleanup ${this.runTag}`,
          );
          await this.summary.update({
            cleanup: {
              attempted: true,
              succeeded: true,
              status: cleanupPayload.status,
              deleted: cleanupPayload.deleted,
              error: null,
            },
          });
        } catch (error) {
          cleanupError = error;
          const message = error instanceof Error ? error.message : String(error);
          await this.summary.update({
            cleanup: {
              attempted: true,
              succeeded: false,
              status: null,
              deleted: {},
              error: message,
            },
          }).catch(() => undefined);
        }
      } else {
        await this.summary.update({
          cleanup: {
            attempted: false,
            succeeded: false,
            status: null,
            deleted: {},
            error: this.cleanupSkippedByConflict ? 'Cleanup skipped after run-tag conflict' : null,
          },
        }).catch(() => undefined);
      }
    } finally {
      await disposeApiUsers(this.userAApi, this.userBApi);
      if (this.adminApi) {
        await this.adminApi.dispose();
      }
      if (this.pageAContext) {
        await this.pageAContext.close();
      }
      if (this.pageBContext) {
        await this.pageBContext.close();
      }
    }

    if (cleanupError && !options.suppressThrow) {
      throw cleanupError;
    }
  }
}

export const test = base.extend<{ runtime: FullStackRuntime }>({
  runtime: async ({ browser }, use, testInfo) => {
    const runtime = new FullStackRuntime(browser, testInfo.title);
    await runtime.initialize();
    let teardownError: unknown = null;
    let thrownFromUse: unknown = null;

    try {
      await use(runtime);
    } catch (error) {
      thrownFromUse = error;
    }

    const recordedTestError = thrownFromUse ?? testInfo.errors[0]?.message ?? null;
    if (recordedTestError) {
      await runtime.recordFailure(recordedTestError);
    }

    try {
      testInfo.setTimeout(testInfo.timeout + CLEANUP_TIMEOUT_MS);
      await runtime.teardown({ suppressThrow: recordedTestError !== null });
    } catch (error) {
      teardownError = error;
      await runtime.recordFailure(error);
    }

    if (recordedTestError) {
      const message = recordedTestError instanceof Error
        ? recordedTestError.message
        : String(recordedTestError);
      await runtime.summary.finalize('failed', message);
      if (thrownFromUse) {
        throw thrownFromUse;
      }
      return;
    }

    if (teardownError) {
      await runtime.summary.finalize('failed', teardownError instanceof Error ? teardownError.message : String(teardownError));
      throw teardownError;
    }

    await runtime.summary.finalize('passed');
  },
});

export { expect };
