import axios from 'axios';
import { PokerServer } from '../server';
import { Game } from '../engine/Game';
import { Player } from '../engine/Player';
import { GameStateStorage, redis } from '../redis';

const TEST_PORT = 3006;

describe('Agent API Endpoints', () => {
  let server: PokerServer;
  let serverInstance: any;
  const gameId = `table_${Date.now()}`;

  beforeAll((done) => {
    server = new PokerServer(TEST_PORT);
    serverInstance = server['server'];
    setTimeout(done, 120);
  });

  afterAll((done) => {
    serverInstance?.close(async () => {
      try {
        await redis.quit();
      } catch {
        // Ignore if already closed by another cleanup path.
      }
      done();
    });
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
  });
});
