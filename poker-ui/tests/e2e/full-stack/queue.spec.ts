import { expect } from '@playwright/test';
import { test, FULL_STACK_ENABLED } from './fullStackTest';
import {
  assertUiSeatAssignments,
  assertUserNotOccupyingSeat,
  awaitActionabilityPair,
  awaitImmediateLeaveAvailable,
  clickHighestPriorityAction,
  getActiveSeatStatus,
  getActiveSessionsForTable,
  getCommunityTableSummary,
  getEnabledActions,
  getTableQueueEntries,
  getTableSeats,
  getWalletBalance,
  joinQueueFromLobby,
  joinSeat,
  locatorByDataValue,
  waitForActionStateChange,
  waitForGameTable,
  waitForSeatAssignment,
} from '../helpers/fullStack';

const API_PROMOTION_DEADLINE_MS = 15_000;
const UI_PROMOTION_DEADLINE_MS = 45_000;
const TABLE_MAX_SEATS = 2;
const RESERVED_BUY_IN_AMOUNT = 350;

test.describe.configure({ mode: 'serial' });

test.describe('Browser full-stack queue promotion', () => {
  test.skip(!FULL_STACK_ENABLED, 'Requires PLAYWRIGHT_FULL_STACK=1');

  test('full table queue promotion reserves buy-in, promotes, and rejoins', async ({ runtime }) => {
    test.setTimeout(420_000);

    const fixture = await runtime.provisionFixture({
      autoSeatPlayers: false,
      actionTimeoutSeconds: 120,
      playerCount: 3,
      maxSeats: 2,
      maxQueueSize: 2,
    });

    await runtime.openAndLoginBrowsers();
    const pageA = runtime.pageA!;
    const pageB = runtime.pageB!;
    const pageC = runtime.pageC!;
    const userAApi = runtime.userAApi!;
    const userBApi = runtime.userBApi!;
    const userCApi = runtime.userCApi!;
    const adminApi = runtime.adminApi!;
    const chosenReservedBuyIn = RESERVED_BUY_IN_AMOUNT;

    await runtime.summary.update({ reserved_buy_in_amount: chosenReservedBuyIn });
    await runtime.summary.markPhase('dashboard_discovery');

    for (const page of [pageA, pageB, pageC]) {
      await expect(locatorByDataValue(page, 'view-lobby-button', 'data-community-id', fixture.community_id)).toBeVisible();
      await locatorByDataValue(page, 'view-lobby-button', 'data-community-id', fixture.community_id).click();
      await expect(page).toHaveURL(new RegExp(`/community/${fixture.community_id}$`));
    }

    await runtime.summary.markPhase('lobby_discovery');
    await expect(locatorByDataValue(pageC, 'join-queue-button', 'data-table-id', fixture.table_id)).toHaveCount(0);

    await runtime.summary.markPhase('join_user_a');
    await joinSeat(pageA, fixture, 1);
    await waitForSeatAssignment(userAApi.request, fixture.table_id, { 1: userAApi.userId });

    await runtime.summary.markPhase('join_user_b');
    await joinSeat(pageB, fixture, 2);
    await waitForSeatAssignment(userBApi.request, fixture.table_id, {
      1: userAApi.userId,
      2: userBApi.userId,
    });

    await waitForGameTable(pageA, 20_000);
    await waitForGameTable(pageB, 20_000);

    await runtime.summary.markPhase('queue_preconditions');
    const preQueueSummary = await getCommunityTableSummary(userCApi.request, fixture.community_id, fixture.table_id);
    expect(Number(preQueueSummary.occupied_seat_count)).toBe(TABLE_MAX_SEATS);
    expect(Number(preQueueSummary.queue_count ?? 0)).toBe(0);
    expect(preQueueSummary.my_queue_position ?? null).toBe(null);
    expect(preQueueSummary.my_queue_buy_in_amount ?? null).toBe(null);
    expect(Boolean((await getActiveSeatStatus(userCApi.request)).active)).toBe(false);
    expect((await getTableSeats(userCApi.request, fixture.table_id)).filter((seat) => seat.user_id !== null)).toHaveLength(2);
    await expect(locatorByDataValue(pageC, 'join-queue-button', 'data-table-id', fixture.table_id)).toBeVisible();

    const walletBeforeQueue = await getWalletBalance(userCApi.request, fixture.community_id);
    await runtime.summary.update({ wallet_before_queue: walletBeforeQueue });

    await runtime.summary.markPhase('queue_join');
    await joinQueueFromLobby(pageC, fixture, chosenReservedBuyIn);

    await expect
      .poll(async () => {
        const [summary, activeSeat, queueEntries, walletBalance] = await Promise.all([
          getCommunityTableSummary(userCApi.request, fixture.community_id, fixture.table_id),
          getActiveSeatStatus(userCApi.request),
          getTableQueueEntries(userCApi.request, fixture.table_id),
          getWalletBalance(userCApi.request, fixture.community_id),
        ]);
        const ownQueueEntry = queueEntries.find((entry) => entry.userId === String(userCApi.userId));
        return {
          myQueuePosition: summary.my_queue_position ?? null,
          myQueueBuyIn: summary.my_queue_buy_in_amount ?? null,
          active: Boolean(activeSeat.active),
          queuePosition: ownQueueEntry?.position ?? null,
          walletBalance,
          occupiedSeatCount: Number(summary.occupied_seat_count ?? 0),
        };
      }, {
        timeout: 15_000,
        intervals: [250, 500, 1000],
      })
      .toEqual({
        myQueuePosition: 1,
        myQueueBuyIn: chosenReservedBuyIn,
        active: false,
        queuePosition: 1,
        walletBalance: walletBeforeQueue - chosenReservedBuyIn,
        occupiedSeatCount: TABLE_MAX_SEATS,
      });

    const walletAfterQueue = await getWalletBalance(userCApi.request, fixture.community_id);
    await runtime.summary.update({
      wallet_after_queue: walletAfterQueue,
      queue_position_before_promotion: 1,
    });

    await runtime.summary.markPhase('prepare_leave');
    const actionsA = await getEnabledActions(pageA);
    if (actionsA.length > 0) {
      await clickHighestPriorityAction(pageA);
      await waitForActionStateChange(pageA, actionsA);
    }
    await awaitActionabilityPair(pageB, pageA, fixture, 60_000);
    await awaitImmediateLeaveAvailable(pageA, 20_000);

    await runtime.summary.markPhase('leave_and_promote');
    await pageA.getByTestId('leave-game-button').click();

    let promotionObservedAt: string | null = null;
    let activeSeatObservedAt: string | null = null;
    let promotedSeatNumber: number | null = null;

    const promotionDeadline = Date.now() + API_PROMOTION_DEADLINE_MS;
    while (Date.now() < promotionDeadline) {
      const [activeSeatC, queueEntriesNow, activeSessions, seats] = await Promise.all([
        getActiveSeatStatus(userCApi.request),
        getTableQueueEntries(userCApi.request, fixture.table_id),
        getActiveSessionsForTable(adminApi, fixture.table_id),
        getTableSeats(userCApi.request, fixture.table_id),
      ]);

      const ownQueueEntry = queueEntriesNow.find((entry) => entry.userId === String(userCApi.userId));
      const promotedSession = activeSessions.find((entry) => Number(entry.user_id) === userCApi.userId);
      const promotedSeat = seats.find((seat) => Number(seat.user_id) === userCApi.userId);

      if (
        !ownQueueEntry
        && Boolean(activeSeatC.active)
        && Number(activeSeatC.table_id) === fixture.table_id
        && promotedSession
        && Number(promotedSession.buy_in_amount) === chosenReservedBuyIn
        && promotedSeat
      ) {
        promotionObservedAt = new Date().toISOString();
        activeSeatObservedAt = promotionObservedAt;
        promotedSeatNumber = Number(promotedSeat.seat_number);
        break;
      }

      await pageC.waitForTimeout(300);
    }

    if (!promotionObservedAt || promotedSeatNumber === null) {
      throw new Error(`Timed out waiting for backend promotion truth within ${API_PROMOTION_DEADLINE_MS}ms`);
    }

    const walletAfterPromotion = await getWalletBalance(userCApi.request, fixture.community_id);
    expect(walletAfterPromotion).toBe(walletAfterQueue);
    await runtime.summary.update({
      wallet_after_promotion: walletAfterPromotion,
      promoted_table_id: fixture.table_id,
      promoted_seat_number: promotedSeatNumber,
      promotion_observed_at: promotionObservedAt,
      active_seat_observed_at: activeSeatObservedAt,
    });

    await runtime.summary.markPhase('promotion_ui_catchup');
    await expect(pageC.getByTestId('queue-promoted-banner')).toBeVisible({ timeout: UI_PROMOTION_DEADLINE_MS });
    const bannerObservedAt = new Date().toISOString();
    await runtime.summary.update({ banner_observed_at: bannerObservedAt });
    await expect(locatorByDataValue(pageC, 'join-table-button', 'data-table-id', fixture.table_id)).toHaveText('Rejoin Table', {
      timeout: UI_PROMOTION_DEADLINE_MS,
    });
    await assertUserNotOccupyingSeat(pageB, fixture.users[0].username, 1);

    await runtime.summary.markPhase('rejoin_promoted_user');
    await locatorByDataValue(pageC, 'join-table-button', 'data-table-id', fixture.table_id).click();
    await expect(pageC).toHaveURL(new RegExp(`/game/${fixture.table_id}\\?communityId=${fixture.community_id}$`));
    await waitForGameTable(pageC, 30_000);
    await waitForGameTable(pageB, 30_000);
    await assertUiSeatAssignments(pageB, pageC, {
      1: fixture.users[2].username,
      2: fixture.users[1].username,
    });
  });
});
