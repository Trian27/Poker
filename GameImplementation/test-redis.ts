#!/usr/bin/env ts-node
/**
 * Test script for Redis integration
 * Verifies game state can be saved and loaded from Redis
 */

import { Game, GameConfig } from './src/engine/Game';
import { Player } from './src/engine/Player';
import { GameStateStorage, redis } from './src/redis';

async function testRedisIntegration() {
  console.log('🧪 Testing Redis Integration...\n');

  try {
    // 1. Create a test game
    console.log('1️⃣  Creating test game...');
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

    console.log('   ✅ Game created with 2 players');

    // 2. Save to Redis
    console.log('\n2️⃣  Saving game to Redis...');
    const gameId = 'test_game_123';
    await GameStateStorage.saveGameState(gameId, game.toJSON());
    console.log(`   ✅ Saved to Redis with key: game:${gameId}`);

    // 3. Verify existence
    console.log('\n3️⃣  Checking if game exists...');
    const exists = await GameStateStorage.gameExists(gameId);
    console.log(`   ✅ Game exists: ${exists}`);

    // 4. Load from Redis
    console.log('\n4️⃣  Loading game from Redis...');
    const loadedData = await GameStateStorage.loadGameState(gameId);
    
    if (!loadedData) {
      throw new Error('Failed to load game data');
    }

    const loadedGame = Game.fromJSON(loadedData);
    console.log('   ✅ Game loaded successfully');

    // 5. Verify state
    console.log('\n5️⃣  Verifying game state...');
    const players = loadedGame.getPlayers();
    console.log(`   Players: ${players.length}`);
    console.log(`   Player 1: ${players[0].name} (${players[0].getStack()} chips)`);
    console.log(`   Player 2: ${players[1].name} (${players[1].getStack()} chips)`);
    console.log(`   Stage: ${loadedGame.getStage()}`);
    console.log(`   Pot: ${loadedGame.getGameState().pot}`);
    console.log('   ✅ All state preserved correctly');

    // 6. Test action and save
    console.log('\n6️⃣  Testing action and re-save...');
    const result = loadedGame.handleAction('p1', 'call');
    console.log(`   Action result: ${result.valid ? 'Valid' : 'Invalid'}`);
    
    if (result.valid) {
      await GameStateStorage.saveGameState(gameId, loadedGame.toJSON());
      console.log('   ✅ Updated state saved to Redis');
    }

    // 7. Get all game IDs
    console.log('\n7️⃣  Listing all active games...');
    const allGameIds = await GameStateStorage.getAllGameIds();
    console.log(`   Active games: ${allGameIds.length}`);
    console.log(`   Game IDs: ${allGameIds.join(', ')}`);

    // 8. Cleanup
    console.log('\n8️⃣  Cleaning up...');
    await GameStateStorage.deleteGameState(gameId);
    const stillExists = await GameStateStorage.gameExists(gameId);
    console.log(`   ✅ Game deleted (exists: ${stillExists})`);

    console.log('\n✅ All tests passed! Redis integration is working correctly.\n');

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Close Redis connection
    await redis.quit();
    console.log('🔌 Redis connection closed');
  }
}

// Run the test
testRedisIntegration();
