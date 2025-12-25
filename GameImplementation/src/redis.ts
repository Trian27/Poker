import Redis from 'ioredis';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const REDIS_DB = parseInt(process.env.REDIS_DB || '0');

/**
 * Redis client for game state storage
 * Only stores game state - NOT communities or leagues (those are in PostgreSQL)
 */
export const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  db: REDIS_DB,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on('connect', () => {
  console.log('✅ Redis connected successfully');
});

redis.on('error', (err: Error) => {
  console.error('❌ Redis connection error:', err.message);
});

redis.on('close', () => {
  console.log('⚠️  Redis connection closed');
});

/**
 * Game state storage helpers
 */
export const GameStateStorage = {
  /**
   * Save game state to Redis (no expiration - games persist until explicitly deleted)
   */
  async saveGameState(gameId: string, state: any): Promise<void> {
    const key = `game:${gameId}`;
    await redis.set(key, JSON.stringify(state)); // No TTL - persists indefinitely
    console.log(`💾 Saved game state: ${gameId}`);
  },

  /**
   * Load game state from Redis
   */
  async loadGameState(gameId: string): Promise<any | null> {
    const key = `game:${gameId}`;
    const data = await redis.get(key);
    if (!data) return null;
    console.log(`📥 Loaded game state: ${gameId}`);
    return JSON.parse(data);
  },

  /**
   * Delete game state from Redis
   */
  async deleteGameState(gameId: string): Promise<void> {
    const key = `game:${gameId}`;
    await redis.del(key);
    console.log(`🗑️  Deleted game state: ${gameId}`);
  },

  /**
   * Check if game state exists
   */
  async gameExists(gameId: string): Promise<boolean> {
    const key = `game:${gameId}`;
    const exists = await redis.exists(key);
    return exists === 1;
  },

  /**
   * Get all active game IDs
   */
  async getAllGameIds(): Promise<string[]> {
    const keys = await redis.keys('game:*');
    return keys.map(key => key.replace('game:', ''));
  }
};

/**
 * Close Redis connection gracefully
 */
export async function closeRedis(): Promise<void> {
  await redis.quit();
  console.log('👋 Redis connection closed');
}
