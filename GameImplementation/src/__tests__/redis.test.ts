/**
 * Redis Integration Tests
 * Tests game state storage and retrieval
 */

import { GameStateStorage, redis } from '../redis';
import { Game, GameConfig } from '../engine/Game';
import { Player } from '../engine/Player';

describe('Redis Integration', () => {
  const testGameId = 'test_game_redis_123';

  afterEach(async () => {
    // Cleanup test data
    await GameStateStorage.deleteGameState(testGameId);
  });

  afterAll(async () => {
    // Close Redis connection
    await redis.quit();
  });

  describe('GameStateStorage', () => {
    it('should save and load game state', async () => {
      // Create a test game
      const config: GameConfig = {
        smallBlind: 10,
        bigBlind: 20,
        initialStack: 1000
      };

      const game = new Game(config);
      const player1 = new Player('p1', 'Alice', 1000);
      const player2 = new Player('p2', 'Bob', 1000);

      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();

      // Save to Redis
      await GameStateStorage.saveGameState(testGameId, game.toJSON());

      // Load from Redis
      const loadedData = await GameStateStorage.loadGameState(testGameId);
      expect(loadedData).toBeTruthy();

      // Verify structure
      expect(loadedData.config).toEqual(config);
      expect(loadedData.players).toHaveLength(2);
      expect(loadedData.pot).toBeGreaterThan(0);
    });

    it('should return null for non-existent game', async () => {
      const result = await GameStateStorage.loadGameState('non_existent_game');
      expect(result).toBeNull();
    });

    it('should check game existence correctly', async () => {
      const config: GameConfig = {
        smallBlind: 10,
        bigBlind: 20,
        initialStack: 1000
      };

      const game = new Game(config);
      await GameStateStorage.saveGameState(testGameId, game.toJSON());

      const exists = await GameStateStorage.gameExists(testGameId);
      expect(exists).toBe(true);

      const notExists = await GameStateStorage.gameExists('fake_game_id');
      expect(notExists).toBe(false);
    });

    it('should delete game state', async () => {
      const config: GameConfig = {
        smallBlind: 10,
        bigBlind: 20,
        initialStack: 1000
      };

      const game = new Game(config);
      await GameStateStorage.saveGameState(testGameId, game.toJSON());

      // Verify it exists
      let exists = await GameStateStorage.gameExists(testGameId);
      expect(exists).toBe(true);

      // Delete it
      await GameStateStorage.deleteGameState(testGameId);

      // Verify it's gone
      exists = await GameStateStorage.gameExists(testGameId);
      expect(exists).toBe(false);
    });

    it('should list all game IDs', async () => {
      // Create multiple games
      const gameIds = ['game_1', 'game_2', 'game_3'];
      const config: GameConfig = {
        smallBlind: 10,
        bigBlind: 20,
        initialStack: 1000
      };

      for (const id of gameIds) {
        const game = new Game(config);
        await GameStateStorage.saveGameState(id, game.toJSON());
      }

      const allGameIds = await GameStateStorage.getAllGameIds();
      
      // Should include all our test games
      for (const id of gameIds) {
        expect(allGameIds).toContain(id);
      }

      // Cleanup
      for (const id of gameIds) {
        await GameStateStorage.deleteGameState(id);
      }
    });

    it('should have no TTL on games', async () => {
      const config: GameConfig = {
        smallBlind: 10,
        bigBlind: 20,
        initialStack: 1000
      };

      const game = new Game(config);
      await GameStateStorage.saveGameState(testGameId, game.toJSON());

      // Check TTL directly
      const ttl = await redis.ttl(`game:${testGameId}`);
      expect(ttl).toBe(-1); // -1 means no expiration
    });

    it('should preserve game state through serialization', async () => {
      // Create a game with specific state
      const config: GameConfig = {
        smallBlind: 10,
        bigBlind: 20,
        initialStack: 1000
      };

      const game = new Game(config);
      const player1 = new Player('p1', 'Alice', 1000);
      const player2 = new Player('p2', 'Bob', 1000);

      game.addPlayer(player1);
      game.addPlayer(player2);
      game.startHand();

      // Make some actions
      game.handleAction('p1', 'call');
      game.handleAction('p2', 'check');

      // Save to Redis
      await GameStateStorage.saveGameState(testGameId, game.toJSON());

      // Load and reconstruct
      const loadedData = await GameStateStorage.loadGameState(testGameId);
      const loadedGame = Game.fromJSON(loadedData);

      // Verify state is preserved
      expect(loadedGame.getStage()).toBe(game.getStage());
      expect(loadedGame.getGameState().pot).toBe(game.getGameState().pot);
      
      const originalPlayers = game.getPlayers();
      const loadedPlayers = loadedGame.getPlayers();
      
      expect(loadedPlayers).toHaveLength(originalPlayers.length);
      expect(loadedPlayers[0].getStack()).toBe(originalPlayers[0].getStack());
      expect(loadedPlayers[1].getStack()).toBe(originalPlayers[1].getStack());
    });
  });
});
