import { Router, Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { checkDatabaseHealth, getDatabaseMetrics } from '@/config/database';
import { checkRedisHealth } from '@/config/redis';
import config from '@/config';

const router = Router();

/**
 * @swagger
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Basic health check
 *     description: Returns basic API health status
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "healthy"
 *                 timestamp:
 *                   type: string
 *                   example: "2025-01-26T12:00:00.000Z"
 *                 version:
 *                   type: string
 *                   example: "v1"
 *                 environment:
 *                   type: string
 *                   example: "development"
 */
router.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: config.apiVersion,
    environment: config.nodeEnv,
    uptime: process.uptime(),
  });
});

/**
 * @swagger
 * /health/detailed:
 *   get:
 *     tags: [Health]
 *     summary: Detailed health check
 *     description: Returns detailed health status including database and Redis connectivity
 *     responses:
 *       200:
 *         description: Detailed health information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "healthy"
 *                 timestamp:
 *                   type: string
 *                 services:
 *                   type: object
 *                   properties:
 *                     database:
 *                       type: object
 *                     redis:
 *                       type: object
 *                 system:
 *                   type: object
 *       503:
 *         description: Some services are unhealthy
 */
router.get('/detailed', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    
    // Check all services in parallel
    const [databaseHealth, redisHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
    ]);
    
    const responseTime = Date.now() - startTime;
    
    // Determine overall status
    const isHealthy = databaseHealth && redisHealth;
    const status = isHealthy ? 'healthy' : 'unhealthy';
    const statusCode = isHealthy ? 200 : 503;
    
    const healthData = {
      status,
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      services: {
        database: {
          status: databaseHealth ? 'healthy' : 'unhealthy',
          type: 'PostgreSQL',
        },
        redis: {
          status: redisHealth ? 'healthy' : 'unhealthy',
          type: 'Redis',
        },
      },
      system: {
        uptime: process.uptime(),
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          unit: 'MB',
        },
        cpu: {
          loadAverage: (process as any).loadavg?.() || [0, 0, 0],
        },
        version: {
          node: process.version,
          api: config.apiVersion,
        },
        environment: config.nodeEnv,
      },
    };
    
    // Log health check
    logger.info('Health check performed', {
      status,
      responseTime,
      services: healthData.services,
      requestId: req.id,
    });
    
    res.status(statusCode).json(healthData);
  } catch (error) {
    logger.error('Health check failed:', error);
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      services: {
        database: { status: 'unknown' },
        redis: { status: 'unknown' },
      },
    });
  }
});

/**
 * @swagger
 * /health/metrics:
 *   get:
 *     tags: [Health]
 *     summary: Application metrics
 *     description: Returns application-specific metrics and statistics
 *     responses:
 *       200:
 *         description: Application metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 database:
 *                   type: object
 *                 system:
 *                   type: object
 *       500:
 *         description: Failed to retrieve metrics
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    
    // Get database metrics
    const databaseMetrics = await getDatabaseMetrics();
    
    const responseTime = Date.now() - startTime;
    
    const metrics = {
      database: databaseMetrics,
      system: {
        uptime: process.uptime(),
        memory: {
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024),
          unit: 'MB',
        },
        cpu: {
          usage: process.cpuUsage(),
          loadAverage: (process as any).loadavg?.() || [0, 0, 0],
        },
      },
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString(),
    };
    
    logger.info('Metrics retrieved', {
      responseTime,
      requestId: req.id,
    });
    
    res.json(metrics);
  } catch (error) {
    logger.error('Failed to retrieve metrics:', error);
    
    res.status(500).json({
      error: 'Failed to retrieve metrics',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @swagger
 * /health/readiness:
 *   get:
 *     tags: [Health]
 *     summary: Readiness probe
 *     description: Kubernetes readiness probe endpoint
 *     responses:
 *       200:
 *         description: Service is ready to receive traffic
 *       503:
 *         description: Service is not ready
 */
router.get('/readiness', async (req: Request, res: Response) => {
  try {
    // Check if all critical services are available
    const [databaseHealth, redisHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
    ]);
    
    if (databaseHealth && redisHealth) {
      res.json({ status: 'ready' });
    } else {
      res.status(503).json({ 
        status: 'not ready',
        issues: {
          database: !databaseHealth,
          redis: !redisHealth,
        },
      });
    }
  } catch (error) {
    logger.error('Readiness check failed:', error);
    res.status(503).json({ status: 'not ready', error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * @swagger
 * /health/liveness:
 *   get:
 *     tags: [Health]
 *     summary: Liveness probe
 *     description: Kubernetes liveness probe endpoint
 *     responses:
 *       200:
 *         description: Service is alive
 */
router.get('/liveness', (req: Request, res: Response) => {
  // Simple liveness check - if we can respond, we're alive
  res.json({ 
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

export default router; 
