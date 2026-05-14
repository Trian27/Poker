import type { Socket as ClientSocket } from 'socket.io-client';
import { ServerHarness, type HarnessUser } from './helpers/serverHarness';

const tableId = 8801;
const gameId = `table_${tableId}`;
const communityId = 77;

const alice: HarnessUser = { id: 9101, username: 'alice_gameplay' };
const bob: HarnessUser = { id: 9102, username: 'bob_gameplay' };

const extractUserId = (playerId: string): number => Number(playerId.match(/^player_(\d+)_/)?.[1]);

const socketForUser = (clients: Record<number, ClientSocket>, userId: number): ClientSocket => {
  const client = clients[userId];
  expect(client).toBeTruthy();
  return client;
};

describe('Server gameplay flows', () => {
  let harness: ServerHarness;

  beforeEach(async () => {
    harness = await ServerHarness.create();
    await harness.seatPlayer({ tableId, userId: alice.id, username: alice.username, stack: 1000, seatNumber: 1, communityId, tableName: 'Gameplay Test Table' });
    await harness.seatPlayer({ tableId, userId: bob.id, username: bob.username, stack: 1000, seatNumber: 2, communityId, tableName: 'Gameplay Test Table' });
  });

  afterEach(async () => {
    await harness.clearGame(gameId);
    await harness.close();
  });

  it('starts a seated table game over sockets and completes a full websocket-driven hand', async () => {
    const aliceSocket = await harness.connectUser(alice, { tableId });
    const bobSocket = await harness.connectUser(bob, { tableId });
    const clients: Record<number, ClientSocket> = { [alice.id]: aliceSocket, [bob.id]: bobSocket };

    await harness.waitForSocketEvent(aliceSocket, 'game_state_update');
    await harness.waitForSocketEvent(bobSocket, 'game_state_update');

    let state = await harness.getGameState(gameId, alice.id);
    const bigBlindUserId = extractUserId(state.players[state.bigBlindIndex].id);
    const firstActorUserId = extractUserId(state.players[state.currentPlayerIndex].id);
    const firstActionUpdate = Promise.all([
      harness.waitForSocketEvent(aliceSocket, 'game_state_update'),
      harness.waitForSocketEvent(bobSocket, 'game_state_update'),
    ]);
    socketForUser(clients, firstActorUserId).emit('game_action', { action: 'call' });
    await firstActionUpdate;

    state = await harness.getGameState(gameId, alice.id);
    expect(state.stage).toBe('preflop');
    expect(extractUserId(state.players[state.currentPlayerIndex].id)).toBe(bigBlindUserId);

    const secondActorUserId = extractUserId(state.players[state.currentPlayerIndex].id);
    const secondActionUpdate = Promise.all([
      harness.waitForSocketEvent(aliceSocket, 'game_state_update'),
      harness.waitForSocketEvent(bobSocket, 'game_state_update'),
    ]);
    socketForUser(clients, secondActorUserId).emit('game_action', { action: 'check' });
    await secondActionUpdate;

    state = await harness.getGameState(gameId, alice.id);
    expect(state.stage).toBe('flop');
    expect(extractUserId(state.players[state.currentPlayerIndex].id)).toBe(bigBlindUserId);

    const flopActorUserId = extractUserId(state.players[state.currentPlayerIndex].id);
    const foldUpdate = Promise.all([
      harness.waitForSocketEvent(aliceSocket, 'game_state_update'),
      harness.waitForSocketEvent(bobSocket, 'game_state_update'),
    ]);
    socketForUser(clients, flopActorUserId).emit('game_action', { action: 'fold' });
    await foldUpdate;

    state = await harness.getGameState(gameId, alice.id);
    expect(state.stage).toBe('complete');
    expect(state.lastHandResult?.endedByFold).toBe(true);
  });

  it('returns action_error for illegal out-of-turn actions without mutating the game state', async () => {
    const aliceSocket = await harness.connectUser(alice, { tableId });
    const bobSocket = await harness.connectUser(bob, { tableId });

    await harness.waitForSocketEvent(aliceSocket, 'game_state_update');
    await harness.waitForSocketEvent(bobSocket, 'game_state_update');

    const stateBefore = await harness.getGameState(gameId, alice.id);
    const currentActorUserId = extractUserId(stateBefore.players[stateBefore.currentPlayerIndex].id);
    const illegalActorSocket = currentActorUserId === alice.id ? bobSocket : aliceSocket;

    illegalActorSocket.emit('game_action', { action: 'fold' });
    const actionError = await harness.waitForSocketEvent<{ error: string }>(illegalActorSocket, 'action_error');
    expect(actionError.error).toBe('Not your turn');

    const stateAfter = await harness.getGameState(gameId, alice.id);
    expect(stateAfter.stage).toBe(stateBefore.stage);
    expect(stateAfter.currentPlayerIndex).toBe(stateBefore.currentPlayerIndex);
    expect(stateAfter.pot).toBe(stateBefore.pot);
  });

  it('restores a seated table game after server restart using Redis-backed state', async () => {
    let aliceSocket = await harness.connectUser(alice, { tableId });
    let bobSocket = await harness.connectUser(bob, { tableId });

    await harness.waitForSocketEvent(aliceSocket, 'game_state_update');
    await harness.waitForSocketEvent(bobSocket, 'game_state_update');

    let state = await harness.getGameState(gameId, alice.id);
    const firstActorUserId = extractUserId(state.players[state.currentPlayerIndex].id);
    const clientsBeforeRestart: Record<number, ClientSocket> = { [alice.id]: aliceSocket, [bob.id]: bobSocket };
    const updateBeforeRestart = Promise.all([
      harness.waitForSocketEvent(aliceSocket, 'game_state_update'),
      harness.waitForSocketEvent(bobSocket, 'game_state_update'),
    ]);
    socketForUser(clientsBeforeRestart, firstActorUserId).emit('game_action', { action: 'call' });
    await updateBeforeRestart;

    const stateBeforeRestart = await harness.getGameState(gameId, alice.id);
    expect(stateBeforeRestart.stage).toBe('preflop');
    expect(extractUserId(stateBeforeRestart.players[stateBeforeRestart.currentPlayerIndex].id))
      .toBe(extractUserId(stateBeforeRestart.players[stateBeforeRestart.bigBlindIndex].id));

    await harness.restart();

    aliceSocket = await harness.connectUser(alice, { tableId });
    bobSocket = await harness.connectUser(bob, { tableId });

    const restoredAliceState = await harness.waitForSocketEvent<any>(aliceSocket, 'game_state_update');
    const restoredBobState = await harness.waitForSocketEvent<any>(bobSocket, 'game_state_update');

    expect(restoredAliceState.gameState.stage).toBe('preflop');
    expect(restoredAliceState.gameState.currentPlayerIndex).toBe(restoredAliceState.gameState.bigBlindIndex);
    expect(restoredBobState.gameState.pot).toBe(stateBeforeRestart.pot);

    state = await harness.getGameState(gameId, alice.id);
    expect(state.stage).toBe(stateBeforeRestart.stage);
    expect(state.currentPlayerIndex).toBe(stateBeforeRestart.currentPlayerIndex);
    expect(state.pot).toBe(stateBeforeRestart.pot);
  }, 10000);
});
