import { expect } from '@playwright/test';
import { test, FULL_STACK_ENABLED, type FullStackRuntime } from './fullStackTest';
import {
  GameplayCoordinator,
  assertNoSeatDrift,
  assertOnGameRoute,
  assertUiSeatAssignments,
  awaitActionabilityPair,
  awaitReconnectingOverlay,
  captureSeatSnapshot,
  clickHighestPriorityAction,
  getActiveSeatStatus,
  getEnabledActions,
  joinSeat,
  locatorByDataValue,
  waitForGameTable,
  waitForActionStateChange,
  waitForSeatAssignment,
} from '../helpers/fullStack';

const RECONNECT_GRACE_MS = 30_000;
const SERVER_DISCONNECT_DETECTION_BUFFER_MS = 60_000;
const ACTIVE_SEAT_INACTIVE_DEADLINE_MS = RECONNECT_GRACE_MS + SERVER_DISCONNECT_DETECTION_BUFFER_MS;

const prepareSeatedGame = async (runtime: FullStackRuntime) => {
  const fixture = await runtime.provisionFixture({
    autoSeatPlayers: false,
    actionTimeoutSeconds: 120,
  });

  const { pageA, pageB } = await runtime.openAndLoginBrowsers();
  const userAApi = runtime.userAApi!;
  const userBApi = runtime.userBApi!;

  await runtime.summary.markPhase('dashboard_discovery');
  await locatorByDataValue(pageA, 'view-lobby-button', 'data-community-id', fixture.community_id).click();
  await locatorByDataValue(pageB, 'view-lobby-button', 'data-community-id', fixture.community_id).click();
  await expect(pageA).toHaveURL(new RegExp(`/community/${fixture.community_id}$`));
  await expect(pageB).toHaveURL(new RegExp(`/community/${fixture.community_id}$`));

  await runtime.summary.markPhase('lobby_discovery');
  await expect(locatorByDataValue(pageA, 'lobby-table-row', 'data-table-id', fixture.table_id)).toContainText(fixture.table_name);
  await expect(locatorByDataValue(pageB, 'lobby-table-row', 'data-table-id', fixture.table_id)).toContainText(fixture.table_name);

  await runtime.summary.markPhase('join_user_a');
  await joinSeat(pageA, fixture, 1);
  await waitForSeatAssignment(userAApi.request, fixture.table_id, { 1: userAApi.userId });

  await runtime.summary.markPhase('join_user_b');
  await joinSeat(pageB, fixture, 2);
  await waitForSeatAssignment(userBApi.request, fixture.table_id, {
    1: userAApi.userId,
    2: userBApi.userId,
  });

  await runtime.summary.markPhase('gameplay');
  await waitForGameTable(pageA, 20_000);
  await waitForGameTable(pageB, 20_000);
  await assertUiSeatAssignments(pageA, pageB, {
    1: fixture.users[0].username,
    2: fixture.users[1].username,
  });

  return { fixture, pageA, pageB, userAApi, userBApi };
};

const waitForSeatInactive = async (userRequest: Parameters<typeof getActiveSeatStatus>[0], deadlineMs: number) => {
  const deadlineAt = Date.now() + deadlineMs;

  while (Date.now() < deadlineAt) {
    const activeSeat = await getActiveSeatStatus(userRequest);
    if (!Boolean(activeSeat.active)) {
      return activeSeat;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
};

const advanceUntilPageActionable = async (
  targetPage: Parameters<typeof getEnabledActions>[0],
  otherPage: Parameters<typeof getEnabledActions>[0],
  timeoutMs: number,
) => {
  const deadlineAt = Date.now() + timeoutMs;

  while (Date.now() < deadlineAt) {
    const [targetActions, otherActions] = await Promise.all([
      getEnabledActions(targetPage),
      getEnabledActions(otherPage),
    ]);

    if (targetActions.length > 0) {
      return targetActions;
    }

    if (otherActions.length > 0) {
      await clickHighestPriorityAction(otherPage);
      await waitForActionStateChange(otherPage, otherActions);
      continue;
    }

    await targetPage.waitForTimeout(250);
  }

  throw new Error(`Timed out waiting to advance hand until target page became actionable: ${targetPage.url()}`);
};

test.describe.configure({ mode: 'serial' });

test.describe('Browser full-stack reconnect suite', () => {
  test.skip(!FULL_STACK_ENABLED, 'Requires PLAYWRIGHT_FULL_STACK=1');

  test('reload rejoin preserves seat and finishes the same live hand', async ({ runtime }) => {
    test.setTimeout(360_000);

    const { fixture, pageA, pageB, userAApi, userBApi } = await prepareSeatedGame(runtime);
    const coordinator = new GameplayCoordinator(pageA, pageB, userAApi, userBApi, fixture, runtime.summary);

    const before = await captureSeatSnapshot(userAApi, userBApi, fixture.table_id);
    await runtime.summary.update({
      seat_state_before: before,
      disruption: { type: 'reload', target_user: 'A' },
    });

    await advanceUntilPageActionable(pageA, pageB, 60_000);
    await coordinator.pauseAndDrain();
    await pageA.reload();

    await assertOnGameRoute(pageA, fixture);
    await waitForGameTable(pageA, 30_000);
    await assertUiSeatAssignments(pageA, pageB, {
      1: fixture.users[0].username,
      2: fixture.users[1].username,
    });

    const after = await captureSeatSnapshot(userAApi, userBApi, fixture.table_id);
    assertNoSeatDrift(before, after);
    await runtime.summary.update({ seat_state_after: after });
    coordinator.resume();

    const persistedHand = await coordinator.playUntilPersistedHand({
      deadlineMs: 180_000,
    });
    await runtime.summary.markPhase('persistence_assertion');
    await runtime.summary.update({ common_hand_id: persistedHand.handId });
    expect(Number(persistedHand.detail.table_id)).toBe(fixture.table_id);
  });

  test('transient disconnect recovers within grace and finishes the hand', async ({ runtime }) => {
    test.setTimeout(360_000);

    const { fixture, pageA, pageB, userAApi, userBApi } = await prepareSeatedGame(runtime);
    const coordinator = new GameplayCoordinator(pageA, pageB, userAApi, userBApi, fixture, runtime.summary);
    const before = await captureSeatSnapshot(userAApi, userBApi, fixture.table_id);
    await runtime.summary.update({
      seat_state_before: before,
      disruption: { type: 'offline-transient', target_user: 'A' },
    });

    await awaitActionabilityPair(pageB, pageA, fixture, 60_000);
    await coordinator.pauseAndDrain();
    await pageA.context().setOffline(true);
    await runtime.summary.update({
      disruption: {
        type: 'offline-transient',
        target_user: 'A',
        offline_started_at: new Date().toISOString(),
      },
    });
    await awaitReconnectingOverlay(pageA, 15_000);
    await runtime.summary.update({
      reconnecting_overlay_observed_page_a: true,
      disruption: {
        type: 'offline-transient',
        target_user: 'A',
        offline_started_at: new Date().toISOString(),
        reconnecting_observed_at: new Date().toISOString(),
      },
    });

    await pageA.waitForTimeout(5_000);
    await pageA.context().setOffline(false);
    await expect(pageA.getByTestId('reconnecting-overlay')).toBeHidden({ timeout: 30_000 });
    await assertOnGameRoute(pageA, fixture);
    await waitForGameTable(pageA, 30_000);

    const after = await captureSeatSnapshot(userAApi, userBApi, fixture.table_id);
    assertNoSeatDrift(before, after);
    await runtime.summary.update({
      seat_state_after: after,
      disruption: {
        type: 'offline-transient',
        target_user: 'A',
        offline_started_at: new Date().toISOString(),
        reconnecting_observed_at: new Date().toISOString(),
        online_restored_at: new Date().toISOString(),
      },
    });
    await assertUiSeatAssignments(pageA, pageB, {
      1: fixture.users[0].username,
      2: fixture.users[1].username,
    });

    coordinator.resume();
    const persistedHand = await coordinator.playUntilPersistedHand({
      deadlineMs: 180_000,
    });
    await runtime.summary.markPhase('persistence_assertion');
    await runtime.summary.update({ common_hand_id: persistedHand.handId });
    expect(Number(persistedHand.detail.table_id)).toBe(fixture.table_id);
  });

  test('reconnect expiry removes the seat and redirects away from the stale route', async ({ runtime }) => {
    test.setTimeout(480_000);

    const { fixture, pageA, pageB, userAApi, userBApi } = await prepareSeatedGame(runtime);
    const coordinator = new GameplayCoordinator(pageA, pageB, userAApi, userBApi, fixture, runtime.summary);
    const before = await captureSeatSnapshot(userAApi, userBApi, fixture.table_id);

    await runtime.summary.update({
      reconnect_grace_ms_expected: RECONNECT_GRACE_MS,
      active_seat_inactive_deadline_ms: ACTIVE_SEAT_INACTIVE_DEADLINE_MS,
      seat_state_before: before,
      disruption: { type: 'offline-expiry', target_user: 'A' },
    });

    await awaitActionabilityPair(pageB, pageA, fixture, 60_000);
    await coordinator.pauseAndDrain();
    await pageA.context().setOffline(true);
    const offlineStartedAt = new Date().toISOString();
    await runtime.summary.update({
      disruption: {
        type: 'offline-expiry',
        target_user: 'A',
        offline_started_at: offlineStartedAt,
      },
    });

    await awaitReconnectingOverlay(pageA, 15_000);
    const reconnectingObservedAt = new Date().toISOString();
    await runtime.summary.update({
      reconnecting_overlay_observed_page_a: true,
      disruption: {
        type: 'offline-expiry',
        target_user: 'A',
        offline_started_at: offlineStartedAt,
        reconnecting_observed_at: reconnectingObservedAt,
      },
    });

    const inactiveSeat = await waitForSeatInactive(userAApi.request, ACTIVE_SEAT_INACTIVE_DEADLINE_MS);
    if (!inactiveSeat) {
      await runtime.summary.markPhase('wait_for_active_seat_inactive');
      await pageA.context().setOffline(false);
      await coordinator.captureDiagnostics();
      throw new Error(`Active seat never became inactive within ${ACTIVE_SEAT_INACTIVE_DEADLINE_MS}ms`);
    }

    const activeSeatInactiveAt = new Date().toISOString();
    await runtime.summary.update({
      disruption: {
        type: 'offline-expiry',
        target_user: 'A',
        offline_started_at: offlineStartedAt,
        reconnecting_observed_at: reconnectingObservedAt,
        active_seat_inactive_at: activeSeatInactiveAt,
      },
    });

    await pageA.context().setOffline(false);
    const onlineRestoredAt = new Date().toISOString();
    await runtime.summary.update({
      disruption: {
        type: 'offline-expiry',
        target_user: 'A',
        offline_started_at: offlineStartedAt,
        reconnecting_observed_at: reconnectingObservedAt,
        active_seat_inactive_at: activeSeatInactiveAt,
        online_restored_at: onlineRestoredAt,
      },
    });

    await expect
      .poll(async () => pageA.url(), {
        timeout: 30_000,
        intervals: [250, 500, 1000],
      })
      .not.toContain(`/game/${fixture.table_id}`);

    await expect(pageA.getByTestId('seat-lost-banner')).toBeVisible({ timeout: 30_000 });
    const bannerText = await pageA.getByTestId('seat-lost-banner').textContent();
    await runtime.summary.update({ last_observed_banner: bannerText?.trim() ?? null });

    const after = await captureSeatSnapshot(userAApi, userBApi, fixture.table_id);
    await runtime.summary.update({ seat_state_after: after });
    expect(Boolean((await getActiveSeatStatus(userAApi.request)).active)).toBe(false);
    expect(after.seats.some((entry) => entry.userId === String(userAApi.userId) && entry.seatNumber === before.userA.seatNumber)).toBe(false);

    await expect
      .poll(async () => {
        const locator = locatorByDataValue(pageB, 'seat-player-name', 'data-seat-number', before.userA.seatNumber ?? 1);
        const count = await locator.count();
        if (count === 0) {
          return false;
        }
        return ((await locator.first().textContent())?.trim() ?? '') === fixture.users[0].username;
      }, {
        timeout: 30_000,
        intervals: [250, 500, 1000],
      })
      .toBe(false);

    await coordinator.captureDiagnostics();
  });
});
