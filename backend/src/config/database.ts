import { PrismaClient } from '@prisma/client';
import config from '@/config';
import { logger } from '@/utils/logger';

let prisma: PrismaClient;

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Prevent multiple instances of Prisma Client in development
if (config.isDevelopment) {
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: [
        { level: 'query', emit: 'event' },
        { level: 'error', emit: 'event' },
        { level: 'info', emit: 'event' },
        { level: 'warn', emit: 'event' },
      ],
    });
  }
  prisma = global.__prisma;
} else {
  prisma = new PrismaClient({
    log: [
      { level: 'error', emit: 'event' },
      { level: 'warn', emit: 'event' },
    ],
  });
}

// Log database queries in development
if (config.isDevelopment) {
  (prisma as any).$on('query', (e: any) => {
    logger.debug('Database Query', {
      query: e.query,
      params: e.params,
      duration: `${e.duration}ms`,
      target: e.target
    });
  });
}

// Log database errors
(prisma as any).$on('error', (e: any) => {
  logger.error('Database Error', {
    message: e.message,
    target: e.target
  });
});

// Log database info
(prisma as any).$on('info', (e: any) => {
  logger.info('Database Info', {
    message: e.message,
    target: e.target
  });
});

// Log database warnings
(prisma as any).$on('warn', (e: any) => {
  logger.warn('Database Warning', {
    message: e.message,
    target: e.target
  });
});

export const connectDatabase = async (): Promise<void> => {
  try {
    await prisma.$connect();
    logger.info('Database connected successfully');
    
    // Test the connection
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Database connection test successful');
    
  } catch (error) {
    logger.error('Failed to connect to database:', error);
    throw error;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected successfully');
  } catch (error) {
    logger.error('Error disconnecting from database:', error);
    throw error;
  }
};

// Health check function
export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error('Database health check failed:', error);
    return false;
  }
};

// Get database metrics
export const getDatabaseMetrics = async () => {
  try {
    const [
      userCount,
      vehicleCount,
      routeCount,
      chargingStationCount
    ] = await Promise.all([
      prisma.user.count(),
      prisma.vehicle.count(),
      prisma.route.count(),
      prisma.chargingStation.count()
    ]);

    return {
      users: userCount,
      vehicles: vehicleCount,
      routes: routeCount,
      chargingStations: chargingStationCount,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Failed to get database metrics:', error);
    throw error;
  }
};

export { prisma };
export default prisma; 
