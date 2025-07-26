import dotenv from 'dotenv';

dotenv.config();

interface Config {
  // Server
  nodeEnv: string;
  port: number;
  apiVersion: string;
  isDevelopment: boolean;
  isProduction: boolean;

  // Database
  database: {
    url: string;
    host: string;
    port: number;
    name: string;
    username: string;
    password: string;
  };

  // Redis
  redis: {
    url: string;
    host: string;
    port: number;
    password?: string;
  };

  // JWT
  jwt: {
    secret: string;
    refreshSecret: string;
    expiresIn: string;
    refreshExpiresIn: string;
  };

  // External APIs
  apis: {
    mapbox: {
      accessToken: string;
    };
    openWeather: {
      apiKey: string;
    };
    googleMaps: {
      apiKey: string;
    };
    chargingStations: {
      url: string;
      apiKey: string;
    };
    osrm: {
      url: string;
    };
  };

  // Email
  email: {
    host: string;
    port: number;
    user: string;
    password: string;
  };

  // File Upload
  upload: {
    maxFileSize: number;
    path: string;
  };

  // Rate Limiting
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };

  // Logging
  logging: {
    level: string;
    file: string;
  };

  // CORS
  cors: {
    origin: string | string[];
  };

  // Socket.IO
  socketIo: {
    corsOrigin: string | string[];
  };

  // Features
  enableSwagger: boolean;
  enableMorganLogging: boolean;
}

const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET'
];

// Check for required environment variables
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

const config: Config = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  apiVersion: process.env.API_VERSION || 'v1',
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // Database
  database: {
    url: process.env.DATABASE_URL!,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'routeplanner',
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
  },

  // Redis
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET!,
    refreshSecret: process.env.JWT_REFRESH_SECRET!,
    expiresIn: process.env.JWT_EXPIRE || '1h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRE || '7d',
  },

  // External APIs
  apis: {
    mapbox: {
      accessToken: process.env.MAPBOX_ACCESS_TOKEN || '',
    },
    openWeather: {
      apiKey: process.env.OPENWEATHER_API_KEY || '',
    },
    googleMaps: {
      apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    },
    chargingStations: {
      url: process.env.CHARGING_STATIONS_API_URL || 'https://api.openchargemap.io/v3',
      apiKey: process.env.OPEN_CHARGE_MAP_API_KEY || '',
    },
    osrm: {
      url: process.env.OSRM_API_URL || 'http://router.project-osrm.org',
    },
  },

  // Email
  email: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASS || '',
  },

  // File Upload
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
    path: process.env.UPLOAD_PATH || 'uploads/',
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '15', 10) * 60 * 1000, // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/app.log',
  },

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  },

  // Socket.IO
  socketIo: {
    corsOrigin: process.env.SOCKET_IO_CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  },

  // Features
  enableSwagger: process.env.ENABLE_SWAGGER === 'true',
  enableMorganLogging: process.env.ENABLE_MORGAN_LOGGING === 'true',
};

export default config; 
