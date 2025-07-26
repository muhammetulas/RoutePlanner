import 'module-alias/register';
import dotenv from 'dotenv';

// Load environment variables first
dotenv.config();

import App from '@/app';
import config from '@/config';
import { logger } from '@/utils/logger';
import { connectDatabase, disconnectDatabase } from '@/config/database';
import { connectRedis, disconnectRedis } from '@/config/redis';

class Server {
  private app: App;

  constructor() {
    this.app = new App();
  }

  public async start(): Promise<void> {
    try {
      // Initialize database connections
      await this.initializeConnections();

      // Start server
      const server = this.app.getServer();
      server.listen(config.port, () => {
        logger.info(`🚀 RoutePlanner Backend API started successfully!`);
        logger.info(`📍 Server running on http://localhost:${config.port}`);
        logger.info(`🌐 Environment: ${config.nodeEnv}`);
        logger.info(`📊 API Version: ${config.apiVersion}`);
        
        if (config.enableSwagger) {
          logger.info(`📚 API Documentation: http://localhost:${config.port}/api/docs`);
        }
      });

      // Graceful shutdown handling
      this.setupGracefulShutdown(server);

    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  private async initializeConnections(): Promise<void> {
    try {
      // Connect to PostgreSQL
      await connectDatabase();
      logger.info('✅ PostgreSQL connected successfully');

      // Connect to Redis
      await connectRedis();
      logger.info('✅ Redis connected successfully');

    } catch (error) {
      logger.error('Failed to initialize connections:', error);
      throw error;
    }
  }

  private setupGracefulShutdown(server: any): void {
    const gracefulShutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);

      // Stop accepting new connections
      server.close(async () => {
        logger.info('HTTP server closed');

        try {
          // Close database connections
          await disconnectDatabase();
          logger.info('Database disconnected');

          // Close Redis connection
          await disconnectRedis();
          logger.info('Redis disconnected');

          logger.info('Graceful shutdown completed');
          process.exit(0);
        } catch (error) {
          logger.error('Error during graceful shutdown:', error);
          process.exit(1);
        }
      });

      // Force close after 30 seconds
      setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 30000);
    };

    // Listen for termination signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });
  }
}

// Start the server
const server = new Server();
server.start(); 
