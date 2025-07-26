import { createClient, RedisClientType } from 'redis';
import config from '@/config';
import { logger } from '@/utils/logger';

let redisClient: RedisClientType;

export const connectRedis = async (): Promise<void> => {
  try {
    redisClient = createClient({
      url: config.redis.url,
      password: config.redis.password,
      socket: {
        connectTimeout: 10000,
      },
      // Note: Redis client handles retries automatically
    });

    // Event listeners
    redisClient.on('connect', () => {
      logger.info('Redis client connecting...');
    });

    redisClient.on('ready', () => {
      logger.info('Redis client connected and ready');
    });

    redisClient.on('error', (error) => {
      logger.error('Redis client error:', error);
    });

    redisClient.on('end', () => {
      logger.info('Redis client connection ended');
    });

    redisClient.on('reconnecting', () => {
      logger.info('Redis client reconnecting...');
    });

    // Connect to Redis
    await redisClient.connect();
    
    // Test the connection
    await redisClient.ping();
    logger.info('Redis connection test successful');

  } catch (error) {
    logger.error('Failed to connect to Redis:', error);
    throw error;
  }
};

export const disconnectRedis = async (): Promise<void> => {
  try {
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
      logger.info('Redis client disconnected successfully');
    }
  } catch (error) {
    logger.error('Error disconnecting from Redis:', error);
    throw error;
  }
};

// Health check function
export const checkRedisHealth = async (): Promise<boolean> => {
  try {
    if (!redisClient || !redisClient.isOpen) {
      return false;
    }
    
    const result = await redisClient.ping();
    return result === 'PONG';
  } catch (error) {
    logger.error('Redis health check failed:', error);
    return false;
  }
};

// Cache helper functions
export const setCache = async (
  key: string, 
  value: any, 
  expireInSeconds?: number
): Promise<void> => {
  try {
    const serializedValue = JSON.stringify(value);
    
    if (expireInSeconds) {
      await redisClient.setEx(key, expireInSeconds, serializedValue);
    } else {
      await redisClient.set(key, serializedValue);
    }
    
    logger.debug(`Cache set: ${key}`, { expireInSeconds });
  } catch (error) {
    logger.error(`Failed to set cache for key ${key}:`, error);
    throw error;
  }
};

export const getCache = async <T = any>(key: string): Promise<T | null> => {
  try {
    const value = await redisClient.get(key);
    
    if (!value) {
      return null;
    }
    
    const parsed = JSON.parse(value);
    logger.debug(`Cache hit: ${key}`);
    return parsed;
    
  } catch (error) {
    logger.error(`Failed to get cache for key ${key}:`, error);
    return null;
  }
};

export const deleteCache = async (key: string): Promise<void> => {
  try {
    await redisClient.del(key);
    logger.debug(`Cache deleted: ${key}`);
  } catch (error) {
    logger.error(`Failed to delete cache for key ${key}:`, error);
    throw error;
  }
};

export const deleteCachePattern = async (pattern: string): Promise<void> => {
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
      logger.debug(`Cache pattern deleted: ${pattern}`, { count: keys.length });
    }
  } catch (error) {
    logger.error(`Failed to delete cache pattern ${pattern}:`, error);
    throw error;
  }
};

export const setCacheHash = async (
  key: string, 
  field: string, 
  value: any
): Promise<void> => {
  try {
    const serializedValue = JSON.stringify(value);
    await redisClient.hSet(key, field, serializedValue);
    logger.debug(`Cache hash set: ${key}.${field}`);
  } catch (error) {
    logger.error(`Failed to set cache hash ${key}.${field}:`, error);
    throw error;
  }
};

export const getCacheHash = async <T = any>(
  key: string, 
  field: string
): Promise<T | null> => {
  try {
    const value = await redisClient.hGet(key, field);
    
    if (!value) {
      return null;
    }
    
    const parsed = JSON.parse(value);
    logger.debug(`Cache hash hit: ${key}.${field}`);
    return parsed;
    
  } catch (error) {
    logger.error(`Failed to get cache hash ${key}.${field}:`, error);
    return null;
  }
};

// Session management
export const setSession = async (
  sessionId: string, 
  sessionData: any, 
  expireInSeconds: number = 3600
): Promise<void> => {
  await setCache(`session:${sessionId}`, sessionData, expireInSeconds);
};

export const getSession = async (sessionId: string): Promise<any> => {
  return await getCache(`session:${sessionId}`);
};

export const deleteSession = async (sessionId: string): Promise<void> => {
  await deleteCache(`session:${sessionId}`);
};

// Rate limiting helpers
export const incrementRateLimit = async (
  key: string, 
  windowSeconds: number = 60
): Promise<number> => {
  try {
    const current = await redisClient.incr(key);
    
    if (current === 1) {
      await redisClient.expire(key, windowSeconds);
    }
    
    return current;
  } catch (error) {
    logger.error(`Failed to increment rate limit for key ${key}:`, error);
    throw error;
  }
};

export const getRateLimit = async (key: string): Promise<number> => {
  try {
    const value = await redisClient.get(key);
    return value ? parseInt(value, 10) : 0;
  } catch (error) {
    logger.error(`Failed to get rate limit for key ${key}:`, error);
    return 0;
  }
};

export { redisClient };
export default redisClient!; 
