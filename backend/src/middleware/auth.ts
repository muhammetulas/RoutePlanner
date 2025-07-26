import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '@/config';
import { logger } from '@/utils/logger';
import { 
  AuthenticationError, 
  AuthorizationError,
  handleJWTError 
} from '@/middleware/errorHandler';
import { getCache, setCache } from '@/config/redis';
import { prisma } from '@/config/database';

// Extend Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        isEmailVerified: boolean;
      };
      id?: string;
    }
  }
}

// JWT Payload interface
interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  tokenType: 'access' | 'refresh';
  iat: number;
  exp: number;
}

// Token blacklist helper
const BLACKLIST_PREFIX = 'blacklist:token:';
const USER_CACHE_PREFIX = 'user:';

export const blacklistToken = async (token: string): Promise<void> => {
  try {
    const decoded = jwt.decode(token) as JWTPayload;
    if (decoded && decoded.exp) {
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await setCache(`${BLACKLIST_PREFIX}${token}`, true, ttl);
      }
    }
  } catch (error) {
    logger.error('Failed to blacklist token:', error);
  }
};

export const isTokenBlacklisted = async (token: string): Promise<boolean> => {
  try {
    const blacklisted = await getCache(`${BLACKLIST_PREFIX}${token}`);
    return blacklisted === true;
  } catch (error) {
    logger.error('Failed to check token blacklist:', error);
    return false;
  }
};

// Extract token from request
const extractToken = (req: Request): string | null => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Also check for token in cookies (for web app)
  if (req.cookies && req.cookies.accessToken) {
    return req.cookies.accessToken;
  }
  
  return null;
};

// Verify JWT token
const verifyToken = async (token: string): Promise<JWTPayload> => {
  try {
    return jwt.verify(token, config.jwt.secret) as JWTPayload;
  } catch (error) {
    throw handleJWTError(error);
  }
};

// Get user from cache or database
const getUser = async (userId: string) => {
  try {
    // Try cache first
    const cacheKey = `${USER_CACHE_PREFIX}${userId}`;
    let user = await getCache(cacheKey);
    
    if (!user) {
      // Fetch from database
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
          isEmailVerified: true,
          isActive: true,
        },
      });
      
      if (!user) {
        throw new AuthenticationError('User not found');
      }
      
      // Cache for 5 minutes
      await setCache(cacheKey, user, 300);
    }
    
    return user;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    logger.error('Failed to get user:', error);
    throw new AuthenticationError('Failed to authenticate user');
  }
};

// Main authentication middleware
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract token
    const token = extractToken(req);
    if (!token) {
      throw new AuthenticationError('Access token required');
    }
    
    // Check if token is blacklisted
    const isBlacklisted = await isTokenBlacklisted(token);
    if (isBlacklisted) {
      throw new AuthenticationError('Token has been revoked');
    }
    
    // Verify token
    const payload = await verifyToken(token);
    
    // Ensure it's an access token
    if (payload.tokenType !== 'access') {
      throw new AuthenticationError('Invalid token type');
    }
    
    // Get user details
    const user = await getUser(payload.userId);
    
    // Check if user is active
    if (!user.isActive) {
      throw new AuthenticationError('User account is deactivated');
    }
    
    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
    };
    
    logger.debug('User authenticated', {
      userId: user.id,
      email: user.email,
      requestId: req.id,
    });
    
    next();
  } catch (error) {
    next(error);
  }
};

// Optional authentication middleware (doesn't throw if no token)
export const optionalAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractToken(req);
    if (!token) {
      return next();
    }
    
    // Check if token is blacklisted
    const isBlacklisted = await isTokenBlacklisted(token);
    if (isBlacklisted) {
      return next();
    }
    
    // Verify token
    const payload = await verifyToken(token);
    
    if (payload.tokenType === 'access') {
      const user = await getUser(payload.userId);
      
      if (user.isActive) {
        req.user = {
          id: user.id,
          email: user.email,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
        };
      }
    }
    
    next();
  } catch (error) {
    // Don't throw error, just continue without user
    logger.debug('Optional auth failed:', error instanceof Error ? error.message : String(error));
    next();
  }
};

// Role-based authorization middleware
export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }
    
    if (!roles.includes(req.user.role)) {
      return next(new AuthorizationError(
        `Access denied. Required roles: ${roles.join(', ')}`
      ));
    }
    
    next();
  };
};

// Email verification requirement middleware
export const requireEmailVerification = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    return next(new AuthenticationError('Authentication required'));
  }
  
  if (!req.user.isEmailVerified) {
    return next(new AuthorizationError('Email verification required'));
  }
  
  next();
};

// Admin role middleware
export const requireAdmin = requireRole('admin');

// User or admin role middleware  
export const requireUserOrAdmin = requireRole('user', 'admin');

// Generate JWT tokens
export const generateTokens = (user: { id: string; email: string; role: string }) => {
  const accessTokenPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
    userId: user.id,
    email: user.email,
    role: user.role,
    tokenType: 'access',
  };
  
  const refreshTokenPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
    userId: user.id,
    email: user.email,
    role: user.role,
    tokenType: 'refresh',
  };
  
  const accessToken = jwt.sign(accessTokenPayload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);
  
  const refreshToken = jwt.sign(refreshTokenPayload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  } as jwt.SignOptions);
  
  return { accessToken, refreshToken };
};

// Refresh token verification
export const verifyRefreshToken = async (token: string): Promise<JWTPayload> => {
  try {
    return jwt.verify(token, config.jwt.refreshSecret) as JWTPayload;
  } catch (error) {
    throw handleJWTError(error);
  }
}; 
