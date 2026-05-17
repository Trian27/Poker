import { ServerHarness, type HarnessUser } from './helpers/serverHarness';

const tableId = 9901;
const gameId = `table_${tableId}`;
const communityId = 91;

const baseUser: HarnessUser = { id: 9201, username: 'promo_base' };
const promotedUser: HarnessUser = { id: 9202, username: 'promo_target' };

const playerForUser = (state: any, userId: number) => (
  state.players.find((player: any) => player.id.startsWith(`player_${userId}_`))
);

describe('Server promotion contracts', () => {
  let harness: ServerHarness;

  beforeEach(async () => {
    harness = await ServerHarness.create();
  });

  afterEach(async () => {
    await harness.clearGame(gameId);
    await harness.close();
  });

  it('records an applied promotion after a successful seat-player call', async () => {
    const promotionId = 'promo-applied';
    const seatResponse = await harness.seatPlayerRaw({
      tableId,
      userId: promotedUser.id,
      username: promotedUser.username,
      stack: 750,
      seatNumber: 1,
      promotionId,
      communityId,
      tableName: 'Promotion Test Table',
    });

    expect(seatResponse.status).toBe(200);
    expect(seatResponse.data.success).toBe(true);
    expect(seatResponse.data.promotion_id).toBe(promotionId);

    const statusResponse = await harness.getPromotionStatus(promotionId);
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.data).toMatchObject({
      status: 'applied',
      promotion_id: promotionId,
      table_id: tableId,
      user_id: promotedUser.id,
      seat_number: 1,
    });
  });

  it('treats the same promotion_id and same payload as idempotent success without duplicate state', async () => {
    const promotionId = 'promo-idempotent';
    const payload = {
      tableId,
      userId: promotedUser.id,
      username: promotedUser.username,
      stack: 725,
      seatNumber: 1,
      promotionId,
      communityId,
      tableName: 'Promotion Test Table',
    };

    const firstResponse = await harness.seatPlayerRaw(payload);
    const secondResponse = await harness.seatPlayerRaw(payload);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.data.idempotent).toBe(true);

    const state = await harness.getGameState(gameId, promotedUser.id);
    const targetPlayers = state.players.filter((player: any) => player.id.startsWith(`player_${promotedUser.id}_`));
    expect(targetPlayers).toHaveLength(1);
    expect(targetPlayers[0].seatNumber).toBe(1);
    expect(targetPlayers[0].stack).toBe(725);
  });

  it('rejects a reused promotion_id with a different payload without mutating the original state', async () => {
    const promotionId = 'promo-mismatch';
    const firstResponse = await harness.seatPlayerRaw({
      tableId,
      userId: promotedUser.id,
      username: promotedUser.username,
      stack: 800,
      seatNumber: 1,
      promotionId,
      communityId,
      tableName: 'Promotion Test Table',
    });

    expect(firstResponse.status).toBe(200);

    const mismatchResponse = await harness.seatPlayerRaw({
      tableId,
      userId: promotedUser.id,
      username: promotedUser.username,
      stack: 800,
      seatNumber: 2,
      promotionId,
      communityId,
      tableName: 'Promotion Test Table',
    });

    expect(mismatchResponse.status).toBe(409);
    expect(mismatchResponse.data.error).toBe('promotion_payload_mismatch');

    const state = await harness.getGameState(gameId, promotedUser.id);
    const targetPlayer = playerForUser(state, promotedUser.id);
    expect(targetPlayer).toBeTruthy();
    expect(targetPlayer.seatNumber).toBe(1);
    expect(state.players.some((player: any) => player.seatNumber === 2 && player.id.startsWith(`player_${promotedUser.id}_`))).toBe(false);

    const statusResponse = await harness.getPromotionStatus(promotionId);
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.data).toMatchObject({
      status: 'applied',
      seat_number: 1,
      user_id: promotedUser.id,
    });
  });

  it('returns the explicit not_found contract for an unknown promotion lookup', async () => {
    const response = await harness.getPromotionStatus('missing-promotion');
    expect(response.status).toBe(404);
    expect(response.data).toMatchObject({
      status: 'not_found',
      promotion_id: 'missing-promotion',
    });
  });

  it('rolls back an applied promotion, removes only the promoted player, and records rolled_back status', async () => {
    await harness.seatPlayer({
      tableId,
      userId: baseUser.id,
      username: baseUser.username,
      stack: 900,
      seatNumber: 1,
      communityId,
      tableName: 'Promotion Test Table',
    });
    const promotionId = 'promo-rollback';
    await harness.seatPlayer({
      tableId,
      userId: promotedUser.id,
      username: promotedUser.username,
      stack: 650,
      seatNumber: 2,
      promotionId,
      communityId,
      tableName: 'Promotion Test Table',
    });

    const rollbackResponse = await harness.rollbackPromotionRaw(promotionId);
    expect(rollbackResponse.status).toBe(200);
    expect(rollbackResponse.data.success).toBe(true);

    const statusResponse = await harness.getPromotionStatus(promotionId);
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.data.status).toBe('rolled_back');

    const state = await harness.getGameState(gameId, baseUser.id);
    expect(playerForUser(state, baseUser.id)).toBeTruthy();
    expect(playerForUser(state, promotedUser.id)).toBeFalsy();
    expect(state.players).toHaveLength(1);
  });

  it('treats rollback of an already rolled-back promotion as idempotent', async () => {
    await harness.seatPlayer({
      tableId,
      userId: baseUser.id,
      username: baseUser.username,
      stack: 950,
      seatNumber: 1,
      communityId,
      tableName: 'Promotion Test Table',
    });
    const promotionId = 'promo-rollback-idempotent';
    await harness.seatPlayer({
      tableId,
      userId: promotedUser.id,
      username: promotedUser.username,
      stack: 610,
      seatNumber: 2,
      promotionId,
      communityId,
      tableName: 'Promotion Test Table',
    });

    const firstRollback = await harness.rollbackPromotionRaw(promotionId);
    const secondRollback = await harness.rollbackPromotionRaw(promotionId);

    expect(firstRollback.status).toBe(200);
    expect(secondRollback.status).toBe(200);

    const statusResponse = await harness.getPromotionStatus(promotionId);
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.data.status).toBe('rolled_back');

    const state = await harness.getGameState(gameId, baseUser.id);
    expect(playerForUser(state, baseUser.id)).toBeTruthy();
    expect(playerForUser(state, promotedUser.id)).toBeFalsy();
    expect(state.players).toHaveLength(1);
  });

  it('rejects reuse of a rolled-back promotion_id', async () => {
    const promotionId = 'promo-rolled-back-reuse';
    const payload = {
      tableId,
      userId: promotedUser.id,
      username: promotedUser.username,
      stack: 680,
      seatNumber: 1,
      promotionId,
      communityId,
      tableName: 'Promotion Test Table',
    };

    const firstResponse = await harness.seatPlayerRaw(payload);
    expect(firstResponse.status).toBe(200);

    const rollbackResponse = await harness.rollbackPromotionRaw(promotionId);
    expect(rollbackResponse.status).toBe(200);

    const reusedResponse = await harness.seatPlayerRaw(payload);
    expect(reusedResponse.status).toBe(409);
    expect(reusedResponse.data.error).toBe('promotion_already_rolled_back');
  });

  it('returns the explicit not_found contract when rolling back an unknown promotion', async () => {
    const response = await harness.rollbackPromotionRaw('missing-promotion');
    expect(response.status).toBe(404);
    expect(response.data).toMatchObject({
      status: 'not_found',
      promotion_id: 'missing-promotion',
    });
  });
});
