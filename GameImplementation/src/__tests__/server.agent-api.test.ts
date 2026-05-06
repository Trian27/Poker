import axios from 'axios';
import { PokerServer } from '../server';
import { Game } from '../engine/Game';
import { Player } from '../engine/Player';
import { GameStateStorage, closeRedis } from '../redis';

const TEST_PORT = 3006;

describe('Agent API Endpoints', () => {
  let server: PokerServer;
  const gameId = `table_${Date.now()}`;

  beforeAll((done) => {
    server = new PokerServer(TEST_PORT);
    setTimeout(done, 120);
  });

  afterAll(async () => {
    await server.close();
    await closeRedis();
  });

  afterEach(async () => {
    await GameStateStorage.deleteGameState(gameId);
  });

  it('supports bot polling and actions through internal API', async () => {
    const userOneId = 91001;
    const userTwoId = 91002;
    const playerOne = new Player(`player_${userOneId}_seed`, 'bot_alpha', 1000, 1);
    const playerTwo = new Player(`player_${userTwoId}_seed`, 'human_beta', 1000, 2);
    const game = new Game({ smallBlind: 10, bigBlind: 20, initialStack: 1000 });
    game.addPlayer(playerOne);
    game.addPlayer(playerTwo);
    game.startHand();
    await GameStateStorage.saveGameState(gameId, game.toJSON());

    const initialStateResponse = await axios.get(`http://localhost:${TEST_PORT}/_internal/game/${gameId}/state`, {
      params: { userId: userOneId },
    });

    expect(initialStateResponse.status).toBe(200);
    expect(initialStateResponse.data.gameState).toBeTruthy();
    expect(initialStateResponse.data.botUserIds).toContain(userOneId);

    const currentIndex = Number(initialStateResponse.data.gameState.currentPlayerIndex);
    const players = Array.isArray(initialStateResponse.data.gameState.players) ? initialStateResponse.data.gameState.players : [];
    const activePlayerIdText = players[currentIndex]?.id as string | undefined;
    expect(typeof activePlayerIdText).toBe('string');
    const activePlayerUserId = Number((activePlayerIdText || '').match(/^player_(\d+)_/)?.[1]);
    expect(Number.isFinite(activePlayerUserId)).toBe(true);

    const actionResponse = await axios.post(`http://localhost:${TEST_PORT}/_internal/agent-action`, {
      userId: activePlayerUserId,
      gameId,
      action: 'call',
    });

    expect(actionResponse.status).toBe(200);
    expect(actionResponse.data.success).toBe(true);
    expect(actionResponse.data.gameState).toBeTruthy();

    const postActionStateResponse = await axios.get(`http://localhost:${TEST_PORT}/_internal/game/${gameId}/state`, {
      params: { userId: userOneId },
    });

    expect(postActionStateResponse.status).toBe(200);
    expect(postActionStateResponse.data.botUserIds).toContain(userOneId);
    expect(postActionStateResponse.data.botUserIds).toContain(activePlayerUserId);

    const preflopState = postActionStateResponse.data.gameState;
    expect(preflopState.stage).toBe('preflop');
    expect(preflopState.currentPlayerIndex).toBe(preflopState.bigBlindIndex);

    const preflopPlayers = Array.isArray(preflopState.players) ? preflopState.players : [];
    const bbPlayerIdText = preflopPlayers[preflopState.currentPlayerIndex]?.id as string | undefined;
    const bbPlayerUserId = Number((bbPlayerIdText || '').match(/^player_(\d+)_/)?.[1]);
    expect(Number.isFinite(bbPlayerUserId)).toBe(true);

    const bbCheckResponse = await axios.post(`http://localhost:${TEST_PORT}/_internal/agent-action`, {
      userId: bbPlayerUserId,
      gameId,
      action: 'check',
    });

    expect(bbCheckResponse.status).toBe(200);
    expect(bbCheckResponse.data.success).toBe(true);

    const flopStateResponse = await axios.get(`http://localhost:${TEST_PORT}/_internal/game/${gameId}/state`, {
      params: { userId: userOneId },
    });

    expect(flopStateResponse.status).toBe(200);
    expect(flopStateResponse.data.gameState.stage).toBe('flop');
    expect(flopStateResponse.data.gameState.currentPlayerIndex).toBe(flopStateResponse.data.gameState.bigBlindIndex);
  });
});
