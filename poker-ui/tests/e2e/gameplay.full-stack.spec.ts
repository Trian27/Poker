import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  type AuthenticatedApiUser,
  type GameplayFixture,
  SummaryTracker,
  createApiContext,
  createAuthenticatedApiUser,
  createFixture,
  cleanupFixture,
  disposeApiUsers,
  findCommonPersistedHand,
  FixtureConflictError,
  generateRunTag,
  getTableSeats,
  getEnabledActions,
  locatorByDataValue,
  loginApi,
  loginViaUi,
  readVisibleBannerText,
  seedReturningVisitor,
  summarizeSeatAssignments,
  validateRunTag,
  waitForActionStateChange,
  waitForSeatAssignment,
} from './helpers/fullStack';

const FULL_STACK_ENABLED = process.env.PLAYWRIGHT_FULL_STACK === '1';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL;
const AUTH_API_URL = process.env.PLAYWRIGHT_AUTH_API_URL;
const GAME_SERVER_URL = process.env.PLAYWRIGHT_GAME_SERVER_URL;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ARTIFACT_DIR = process.env.PLAYWRIGHT_ARTIFACT_DIR || 'test-results/browser-full-stack';
const BROWSER_VIEWPORT = { width: 1366, height: 768 };

const requiredEnv = {
  PLAYWRIGHT_BASE_URL: BASE_URL,
  PLAYWRIGHT_AUTH_API_URL: AUTH_API_URL,
  PLAYWRIGHT_GAME_SERVER_URL: GAME_SERVER_URL,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
};

function actionLocatorOwner(page: Page): string {
  return page.url();
}

async function clickHighestPriorityAction(page: Page): Promise<'check' | 'call' | 'fold'> {
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
  throw new Error(`No enabled actions available on ${actionLocatorOwner(page)}`);
}

async function describeActionablePage(page: Page, name: string) {
  const actions = await getEnabledActions(page);
  const street = await page.getByTestId('street-label').textContent().catch(() => null);
  const errorBanner = await readVisibleBannerText(page, '.error-banner').catch(() => null);
  const bustedBanner = await readVisibleBannerText(page, '.busted-banner').catch(() => null);
  return {
    name,
    url: page.url(),
    street,
    actions,
    errorBanner,
    bustedBanner,
  };
}

async function assertGameplayStillHealthy(
  fixture: GameplayFixture,
  pageA: Page,
  pageB: Page,
  userAApi: AuthenticatedApiUser,
  userBApi: AuthenticatedApiUser,
) {
  const expectedGameUrl = `/game/${fixture.table_id}?communityId=${fixture.community_id}`;
  const pageDiagnostics = await Promise.all([
    describeActionablePage(pageA, fixture.users[0].username),
    describeActionablePage(pageB, fixture.users[1].username),
  ]);

  for (const diagnostic of pageDiagnostics) {
    if (!diagnostic.url.includes(expectedGameUrl)) {
      throw new Error(`Gameplay state lost: ${diagnostic.name} left the game route: ${JSON.stringify(pageDiagnostics)}`);
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
}

async function joinSeat(
  page: Page,
  fixture: { community_id: number; table_id: number; table_name: string },
  seatNumber: number,
): Promise<void> {
  await expect(locatorByDataValue(page, 'lobby-table-row', 'data-table-id', fixture.table_id)).toContainText(fixture.table_name);
  await locatorByDataValue(page, 'join-table-button', 'data-table-id', fixture.table_id).click();
  await expect(page.getByText(`Join ${fixture.table_name}`)).toBeVisible();
  await locatorByDataValue(page, 'seat-button', 'data-seat-number', seatNumber).click();
  await page.getByTestId('confirm-join-button').click();
  await expect(page).toHaveURL(new RegExp(`/game/${fixture.table_id}\\?communityId=${fixture.community_id}$`));
}

async function createBrowserContext(browser: Browser, baseUrl: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: BROWSER_VIEWPORT,
  });
  await seedReturningVisitor(context, baseUrl);
  const page = await context.newPage();
  return { context, page };
}

test.describe.configure({ mode: 'serial' });

test.describe('Gameplay full-stack flow', () => {
  test.skip(!FULL_STACK_ENABLED, 'Requires PLAYWRIGHT_FULL_STACK=1');

  test('logs in two real users, joins through the lobby, completes a real hand, and cleans up', async ({ browser }) => {
    test.setTimeout(300_000);

    const missingEnv = Object.entries(requiredEnv)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    expect(missingEnv, `Missing required env: ${missingEnv.join(', ')}`).toEqual([]);

    const summary = new SummaryTracker(ARTIFACT_DIR);
    const runTag = validateRunTag(generateRunTag());
    let adminApi: APIRequestContext | null = null;
    let userAApi: AuthenticatedApiUser | null = null;
    let userBApi: AuthenticatedApiUser | null = null;
    let pageAContext: BrowserContext | null = null;
    let pageBContext: BrowserContext | null = null;
    let cleanupAttempted = false;
    let cleanupAllowed = false;
    let fixtureCreateDispatched = false;
    let cleanupSkippedByConflict = false;
    let fixture: GameplayFixture | null = null;
    let pendingError: unknown = null;

    await summary.update({ run_tag: runTag, auto_seat_players: false });

    try {
      await summary.markPhase('preflight');
      const baseUrl = BASE_URL!;
      const authApiUrl = AUTH_API_URL!;
      const gameServerUrl = GAME_SERVER_URL!;

      const [authHealth, gameHealth] = await Promise.all([
        createApiContext(authApiUrl),
        createApiContext(gameServerUrl),
      ]);
      try {
        const [authResponse, gameResponse] = await Promise.all([
          authHealth.get('/health'),
          gameHealth.get('/health'),
        ]);
        expect(authResponse.ok()).toBe(true);
        expect(gameResponse.ok()).toBe(true);
      } finally {
        await authHealth.dispose();
        await gameHealth.dispose();
      }

      const adminLogin = await loginApi(authApiUrl, ADMIN_USERNAME!, ADMIN_PASSWORD!);
      adminApi = await createApiContext(authApiUrl, adminLogin.token);

      const loginProbeContext = await browser.newContext({ baseURL: baseUrl, viewport: BROWSER_VIEWPORT });
      try {
        const loginProbePage = await loginProbeContext.newPage();
        await seedReturningVisitor(loginProbeContext, baseUrl);
        await loginProbePage.goto('/login');
        await expect(loginProbePage.getByTestId('login-submit-button')).toBeVisible();
      } finally {
        await loginProbeContext.close();
      }

      await summary.markPhase('fixture_create');
      fixtureCreateDispatched = true;
      await summary.update({ fixture_create_dispatched: true });
      try {
        fixture = await createFixture(adminApi, runTag);
      } catch (error) {
        if (error instanceof FixtureConflictError) {
          cleanupSkippedByConflict = true;
        }
        throw error;
      }
      cleanupAllowed = true;
      if (!fixture) {
        throw new Error('Fixture creation did not return a fixture payload');
      }
      await summary.update({
        fixture_create_succeeded: true,
        auto_seat_players: fixture.auto_seat_players,
        league_id: fixture.league_id,
        league_name: fixture.league_name,
        community_id: fixture.community_id,
        community_name: fixture.community_name,
        table_id: fixture.table_id,
        table_name: fixture.table_name,
        game_id: fixture.game_id,
      });

      [userAApi, userBApi] = await Promise.all([
        createAuthenticatedApiUser(authApiUrl, fixture.users[0]),
        createAuthenticatedApiUser(authApiUrl, fixture.users[1]),
      ]);

      await summary.markPhase('browser_login');
      const [{ context: contextA, page: pageA }, { context: contextB, page: pageB }] = await Promise.all([
        createBrowserContext(browser, baseUrl),
        createBrowserContext(browser, baseUrl),
      ]);
      pageAContext = contextA;
      pageBContext = contextB;

      await loginViaUi(pageA, fixture.users[0].username, fixture.users[0].password);
      await loginViaUi(pageB, fixture.users[1].username, fixture.users[1].password);

      await summary.markPhase('dashboard_discovery');
      await expect(locatorByDataValue(pageA, 'league-card', 'data-league-id', fixture.league_id)).toContainText(fixture.league_name);
      await expect(locatorByDataValue(pageB, 'league-card', 'data-league-id', fixture.league_id)).toContainText(fixture.league_name);
      await expect(locatorByDataValue(pageA, 'community-card', 'data-community-id', fixture.community_id)).toContainText(fixture.community_name);
      await expect(locatorByDataValue(pageB, 'community-card', 'data-community-id', fixture.community_id)).toContainText(fixture.community_name);
      await locatorByDataValue(pageA, 'view-lobby-button', 'data-community-id', fixture.community_id).click();
      await locatorByDataValue(pageB, 'view-lobby-button', 'data-community-id', fixture.community_id).click();
      await expect(pageA).toHaveURL(new RegExp(`/community/${fixture.community_id}$`));
      await expect(pageB).toHaveURL(new RegExp(`/community/${fixture.community_id}$`));

      await summary.markPhase('lobby_discovery');
      await expect(locatorByDataValue(pageA, 'lobby-table-row', 'data-table-id', fixture.table_id)).toContainText(fixture.table_name);
      await expect(locatorByDataValue(pageB, 'lobby-table-row', 'data-table-id', fixture.table_id)).toContainText(fixture.table_name);

      await summary.markPhase('join_user_a');
      await joinSeat(pageA, fixture, 1);
      await waitForSeatAssignment(userAApi.request, fixture.table_id, { 1: userAApi.userId });

      await summary.markPhase('join_user_b');
      await joinSeat(pageB, fixture, 2);
      await waitForSeatAssignment(userBApi.request, fixture.table_id, {
        1: userAApi.userId,
        2: userBApi.userId,
      });

      await summary.markPhase('gameplay');
      await expect(pageA.getByTestId('game-table')).toBeVisible({ timeout: 20_000 });
      await expect(pageB.getByTestId('game-table')).toBeVisible({ timeout: 20_000 });
      await expect(locatorByDataValue(pageA, 'seat-player-name', 'data-seat-number', 1)).toHaveText(fixture.users[0].username);
      await expect(locatorByDataValue(pageA, 'seat-player-name', 'data-seat-number', 2)).toHaveText(fixture.users[1].username);
      await expect(locatorByDataValue(pageB, 'seat-player-name', 'data-seat-number', 1)).toHaveText(fixture.users[0].username);
      await expect(locatorByDataValue(pageB, 'seat-player-name', 'data-seat-number', 2)).toHaveText(fixture.users[1].username);

      const gameplayDeadline = Date.now() + 150_000;
      let lastProgressAt = Date.now();
      let lastHealthCheckAt = 0;
      let persistedHand = await findCommonPersistedHand(userAApi, userBApi, fixture);

      while (!persistedHand && Date.now() < gameplayDeadline) {
        const [actionsA, actionsB] = await Promise.all([
          getEnabledActions(pageA),
          getEnabledActions(pageB),
        ]);
        const actionablePages = [
          { name: fixture.users[0].username, page: pageA, actions: actionsA },
          { name: fixture.users[1].username, page: pageB, actions: actionsB },
        ].filter((entry) => entry.actions.length > 0);

        if (actionablePages.length > 1) {
          const diagnostics = await Promise.all([
            describeActionablePage(pageA, fixture.users[0].username),
            describeActionablePage(pageB, fixture.users[1].username),
          ]);
          throw new Error(`Both pages appeared actionable at once: ${JSON.stringify(diagnostics)}`);
        }

        if (actionablePages.length === 1) {
          const activePage = actionablePages[0];
          await clickHighestPriorityAction(activePage.page);
          await waitForActionStateChange(activePage.page, activePage.actions);
          lastProgressAt = Date.now();
        } else {
          await pageA.waitForTimeout(300);
        }

        if (Date.now() - lastProgressAt > 20_000) {
          throw new Error('Gameplay coordinator made no progress for 20 seconds');
        }

        if (Date.now() - lastHealthCheckAt > 5_000) {
          await assertGameplayStillHealthy(fixture, pageA, pageB, userAApi, userBApi);
          lastHealthCheckAt = Date.now();
        }

        persistedHand = await findCommonPersistedHand(userAApi, userBApi, fixture);
        if (persistedHand) {
          lastProgressAt = Date.now();
        }
      }

      expect(persistedHand, 'Expected a persisted common hand before timeout').not.toBeNull();
      if (!persistedHand) {
        throw new Error('Expected a persisted common hand before timeout');
      }

      await summary.markPhase('persistence_assertion');
      await summary.update({ common_hand_id: persistedHand.handId });
      expect(Number(persistedHand.detail.table_id)).toBe(fixture.table_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pendingError = error;
      await summary.update({ error: message, status: 'failed' }).catch(() => undefined);
    } finally {
      await summary.markPhase('cleanup').catch(() => undefined);
      if (adminApi && runTag && fixtureCreateDispatched && !cleanupSkippedByConflict) {
        cleanupAttempted = true;
        try {
          const cleanupPayload = await cleanupFixture(adminApi, runTag);
          await summary.update({
            cleanup: {
              attempted: true,
              succeeded: true,
              status: cleanupPayload.status,
              deleted: cleanupPayload.deleted,
              error: null,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await summary.update({
            cleanup: {
              attempted: true,
              succeeded: false,
              status: null,
              deleted: {},
              error: message,
            },
          });
          if (!pendingError && cleanupAllowed) {
            pendingError = error;
          }
        }
      } else if (cleanupAttempted === false) {
        await summary.update({
          cleanup: {
            attempted: false,
            succeeded: false,
            status: null,
            deleted: {},
            error: cleanupSkippedByConflict ? 'Cleanup skipped after run-tag conflict' : null,
          },
        }).catch(() => undefined);
      }

      await disposeApiUsers(userAApi, userBApi);
      if (adminApi) {
        await adminApi.dispose();
      }
      if (pageAContext) {
        await pageAContext.close();
      }
      if (pageBContext) {
        await pageBContext.close();
      }
    }

    if (pendingError) {
      const message = pendingError instanceof Error ? pendingError.message : String(pendingError);
      await summary.finalize('failed', message);
      throw pendingError;
    }

    await summary.finalize('passed');
  });
});
