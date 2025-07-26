import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Server } from 'socket.io';
import http from 'http';

import config from '@/config';
import { logger } from '@/utils/logger';
import { errorHandler, notFoundHandler } from '@/middleware/errorHandler';
import { authMiddleware } from '@/middleware/auth';

// Import routes
import authRoutes from '@/routes/auth';
import userRoutes from '@/routes/users';
import vehicleRoutes from '@/routes/vehicles';
import routeRoutes from '@/routes/routes';
import chargingStationRoutes from '@/routes/chargingStations';
import mapRoutes from '@/routes/map';
import healthRoutes from '@/routes/health';

class App {
  public app: Express;
  public server: http.Server;
  public io: Server;

  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: config.socketIo.corsOrigin,
        credentials: true,
      },
    });

    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling();
    this.initializeSwagger();
    this.initializeSocketIO();
  }

  private initializeMiddlewares(): void {
    // Security middleware
    this.app.use(helmet());
    
    // CORS
    this.app.use(cors({
      origin: config.cors.origin,
      credentials: true,
    }));

    // Compression
    this.app.use(compression());

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Logging
    if (config.isDevelopment && config.enableMorganLogging) {
      this.app.use(morgan('combined', {
        stream: { write: (message) => logger.info(message.trim()) }
      }));
    }

    // Rate limiting
    const limiter = rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.maxRequests,
      message: {
        error: 'Too many requests from this IP, please try again later.'
      },
    });
    this.app.use('/api/', limiter);

    // Request ID middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      req.id = Math.random().toString(36).substr(2, 9);
      res.setHeader('X-Request-ID', req.id);
      next();
    });
  }

  private initializeRoutes(): void {
    const apiPrefix = `/api/${config.apiVersion}`;

    // Health check (no auth required)
    this.app.use(`${apiPrefix}/health`, healthRoutes);

    // Authentication routes (no auth required)
    this.app.use(`${apiPrefix}/auth`, authRoutes);

    // Protected routes (require authentication)
    this.app.use(`${apiPrefix}/users`, authMiddleware, userRoutes);
    this.app.use(`${apiPrefix}/vehicles`, authMiddleware, vehicleRoutes);
    this.app.use(`${apiPrefix}/routes`, authMiddleware, routeRoutes);
    this.app.use(`${apiPrefix}/charging-stations`, chargingStationRoutes);
    this.app.use(`${apiPrefix}/map`, mapRoutes); // Map routes have their own auth middleware

    // Root endpoint
    this.app.get('/', (req: Request, res: Response) => {
      res.json({
        message: 'RoutePlanner API',
        version: config.apiVersion,
        environment: config.nodeEnv,
        timestamp: new Date().toISOString(),
      });
    });
  }

  private initializeErrorHandling(): void {
    // 404 handler
    this.app.use(notFoundHandler);
    
    // Global error handler
    this.app.use(errorHandler);
  }

  private initializeSwagger(): void {
    if (config.enableSwagger) {
      const options = {
        definition: {
          openapi: '3.0.0',
          info: {
            title: 'RoutePlanner API',
            version: '1.0.0',
            description: 'Electric Vehicle Route Planning API',
            contact: {
              name: 'Muhammet Ulaş',
              email: 'contact@routeplanner.com',
            },
          },
          servers: [
            {
              url: `http://localhost:${config.port}/api/${config.apiVersion}`,
              description: 'Development server',
            },
          ],
          components: {
            securitySchemes: {
              bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
              },
            },
          },
        },
        apis: ['./src/routes/*.ts', './src/models/*.ts'],
      };

      const specs = swaggerJsdoc(options);
      this.app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(specs));
      
      logger.info(`Swagger documentation available at http://localhost:${config.port}/api/docs`);
    }
  }

  private initializeSocketIO(): void {
    this.io.on('connection', (socket) => {
      logger.info(`Socket client connected: ${socket.id}`);

      socket.on('join-route', (routeId: string) => {
        socket.join(`route-${routeId}`);
        logger.info(`Socket ${socket.id} joined route ${routeId}`);
      });

      socket.on('leave-route', (routeId: string) => {
        socket.leave(`route-${routeId}`);
        logger.info(`Socket ${socket.id} left route ${routeId}`);
      });

      socket.on('disconnect', () => {
        logger.info(`Socket client disconnected: ${socket.id}`);
      });
    });
  }

  public getServer(): http.Server {
    return this.server;
  }

  public getSocketIO(): Server {
    return this.io;
  }
}

export default App; 
