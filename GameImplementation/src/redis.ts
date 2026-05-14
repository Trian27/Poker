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

let redisShutdownRequested = false;

async function waitForRedisReady(timeoutMs: number = 3000): Promise<void> {
  if (redis.status === 'ready') {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      redis.off('ready', onReady);
      redis.off('error', onError);
    };

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for Redis ready state (status=${redis.status})`));
    }, timeoutMs);

    redis.on('ready', onReady);
    redis.on('error', onError);
  });
}

function isExpectedRedisShutdownError(err: Error): boolean {
  const message = err.message || '';
  return (
    message.includes('Connection is closed') ||
    message.includes('ECONNRESET') ||
    message.includes('Connection in subscriber mode')
  );
}

redis.on('connect', () => {
  redisShutdownRequested = false;
  console.log('✅ Redis connected successfully');
});

redis.on('error', (err: Error) => {
  if (redisShutdownRequested && isExpectedRedisShutdownError(err)) {
    return;
  }
  console.error('❌ Redis connection error:', err.message);
});

redis.on('close', () => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  console.log('⚠️  Redis connection closed');
});

export async function ensureRedisConnection(): Promise<void> {
  if (redis.status === 'ready') {
    return;
  }

  if (redis.status === 'wait' || redis.status === 'end') {
    await redis.connect();
  }

  await waitForRedisReady();
}

/**
 * Game state storage helpers
 */
export const GameStateStorage = {
  /**
   * Save game state to Redis (no expiration - games persist until explicitly deleted)
   */
  async saveGameState(gameId: string, state: any): Promise<void> {
    await ensureRedisConnection();
    const key = `game:${gameId}`;
    await redis.set(key, JSON.stringify(state)); // No TTL - persists indefinitely
    console.log(`💾 Saved game state: ${gameId}`);
  },

  /**
   * Load game state from Redis
   */
  async loadGameState(gameId: string): Promise<any | null> {
    await ensureRedisConnection();
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
    await ensureRedisConnection();
    const key = `game:${gameId}`;
    await redis.del(key);
    console.log(`🗑️  Deleted game state: ${gameId}`);
  },

  /**
   * Check if game state exists
   */
  async gameExists(gameId: string): Promise<boolean> {
    await ensureRedisConnection();
    const key = `game:${gameId}`;
    const exists = await redis.exists(key);
    return exists === 1;
  },

  /**
   * Get all active game IDs
   */
  async getAllGameIds(): Promise<string[]> {
    await ensureRedisConnection();
    const keys = await redis.keys('game:*');
    return keys.map(key => key.replace('game:', ''));
  }
};

/**
 * Close Redis connection gracefully
 */
export async function closeRedis(): Promise<void> {
  redisShutdownRequested = true;

  if (redis.status === 'end') {
    return;
  }

  try {
    if (redis.status === 'wait') {
      redis.disconnect(false);
      return;
    }

    await redis.quit();
  } catch (error) {
    if (!(error instanceof Error) || !isExpectedRedisShutdownError(error)) {
      throw error;
    }
  } finally {
    if (process.env.NODE_ENV !== 'test') {
      console.log('👋 Redis connection closed');
    }
  }
}
