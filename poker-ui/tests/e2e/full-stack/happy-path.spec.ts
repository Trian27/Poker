import { test, expect, FULL_STACK_ENABLED } from './fullStackTest';
import {
  GameplayCoordinator,
  assertUiSeatAssignments,
  captureSeatSnapshot,
  joinSeat,
  locatorByDataValue,
  waitForGameTable,
  waitForSeatAssignment,
} from '../helpers/fullStack';

test.describe.configure({ mode: 'serial' });

test.describe('Browser full-stack happy path', () => {
  test.skip(!FULL_STACK_ENABLED, 'Requires PLAYWRIGHT_FULL_STACK=1');

  test('happy path joins through lobby, completes a real hand, and cleans up', async ({ runtime }) => {
    test.setTimeout(300_000);

    const fixture = await runtime.provisionFixture({
      autoSeatPlayers: false,
      actionTimeoutSeconds: 60,
    });

    const { pageA, pageB } = await runtime.openAndLoginBrowsers();
    const userAApi = runtime.userAApi!;
    const userBApi = runtime.userBApi!;

    await runtime.summary.markPhase('dashboard_discovery');
    await expect(locatorByDataValue(pageA, 'league-card', 'data-league-id', fixture.league_id)).toContainText(fixture.league_name);
    await expect(locatorByDataValue(pageB, 'league-card', 'data-league-id', fixture.league_id)).toContainText(fixture.league_name);
    await expect(locatorByDataValue(pageA, 'community-card', 'data-community-id', fixture.community_id)).toContainText(fixture.community_name);
    await expect(locatorByDataValue(pageB, 'community-card', 'data-community-id', fixture.community_id)).toContainText(fixture.community_name);
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

    const initialSnapshot = await captureSeatSnapshot(userAApi, userBApi, fixture.table_id);
    await runtime.summary.update({ seat_state_before: initialSnapshot });

    const coordinator = new GameplayCoordinator(pageA, pageB, userAApi, userBApi, fixture, runtime.summary);
    const persistedHand = await coordinator.playUntilPersistedHand({
      deadlineMs: 150_000,
    });

    await runtime.summary.markPhase('persistence_assertion');
    await runtime.summary.update({
      common_hand_id: persistedHand.handId,
      seat_state_after: await captureSeatSnapshot(userAApi, userBApi, fixture.table_id),
    });
    expect(Number(persistedHand.detail.table_id)).toBe(fixture.table_id);
  });
});
