import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';
import config from '@/config';

// Custom error classes
export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public errorCode?: string;

  constructor(message: string, statusCode: number, errorCode?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.errorCode = errorCode;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  public field?: string;
  public value?: any;

  constructor(message: string, field?: string, value?: any) {
    super(message, 400, 'VALIDATION_ERROR');
    this.field = field;
    this.value = value;
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  public resource?: string;

  constructor(message: string, resource?: string) {
    super(message, 404, 'NOT_FOUND_ERROR');
    this.resource = resource;
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT_ERROR');
  }
}

export class RateLimitError extends AppError {
  public retryAfter?: number;

  constructor(message: string = 'Too many requests', retryAfter?: number) {
    super(message, 429, 'RATE_LIMIT_ERROR');
    this.retryAfter = retryAfter;
  }
}

export class ExternalServiceError extends AppError {
  public service?: string;

  constructor(message: string, service?: string) {
    super(message, 502, 'EXTERNAL_SERVICE_ERROR');
    this.service = service;
  }
}

// Error response interface
interface ErrorResponse {
  error: {
    message: string;
    code?: string;
    statusCode: number;
    timestamp: string;
    requestId?: string;
    details?: any;
    stack?: string;
  };
}

// Format error response
const formatErrorResponse = (
  error: Error | AppError,
  req: Request
): ErrorResponse => {
  const isAppError = error instanceof AppError;
  const statusCode = isAppError ? error.statusCode : 500;
  
  const response: ErrorResponse = {
    error: {
      message: error.message || 'Internal server error',
      statusCode,
      timestamp: new Date().toISOString(),
      requestId: req.id,
    },
  };

  // Add error code if available
  if (isAppError && error.errorCode) {
    response.error.code = error.errorCode;
  }

  // Add specific error details based on error type
  if (error instanceof ValidationError) {
    response.error.details = {
      field: error.field,
      value: error.value,
    };
  } else if (error instanceof NotFoundError) {
    response.error.details = {
      resource: error.resource,
    };
  } else if (error instanceof RateLimitError) {
    response.error.details = {
      retryAfter: error.retryAfter,
    };
  } else if (error instanceof ExternalServiceError) {
    response.error.details = {
      service: error.service,
    };
  }

  // Include stack trace in development
  if (config.isDevelopment) {
    response.error.stack = error.stack;
  }

  return response;
};

// Main error handler middleware
export const errorHandler = (
  error: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const isAppError = error instanceof AppError;
  const statusCode = isAppError ? error.statusCode : 500;

  // Log error
  if (statusCode >= 500) {
    logger.error('Server Error', {
      message: error.message,
      stack: error.stack,
      requestId: req.id,
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    });
  } else if (statusCode >= 400) {
    logger.warn('Client Error', {
      message: error.message,
      statusCode,
      requestId: req.id,
      method: req.method,
      url: req.url,
    });
  }

  // Format and send error response
  const errorResponse = formatErrorResponse(error, req);
  res.status(statusCode).json(errorResponse);
};

// 404 handler
export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const error = new NotFoundError(`Route ${req.method} ${req.path} not found`);
  next(error);
};

// Async error wrapper
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Validation error handler for Joi
export const handleValidationError = (error: any): ValidationError => {
  if (error.details && error.details[0]) {
    const detail = error.details[0];
    return new ValidationError(
      detail.message,
      detail.path?.join('.'),
      detail.context?.value
    );
  }
  return new ValidationError(error.message || 'Validation failed');
};

// Database error handler
export const handleDatabaseError = (error: any): AppError => {
  // Prisma specific errors
  if (error.code === 'P2002') {
    return new ConflictError('A record with this data already exists');
  }
  if (error.code === 'P2025') {
    return new NotFoundError('Record not found');
  }
  if (error.code === 'P2003') {
    return new ValidationError('Foreign key constraint failed');
  }

  // Generic database error
  logger.error('Database error:', error);
  return new AppError('Database operation failed', 500, 'DATABASE_ERROR');
};

// JWT error handler
export const handleJWTError = (error: any): AppError => {
  if (error.name === 'JsonWebTokenError') {
    return new AuthenticationError('Invalid token');
  }
  if (error.name === 'TokenExpiredError') {
    return new AuthenticationError('Token expired');
  }
  return new AuthenticationError('Authentication failed');
};

// Export error classes for use in other modules
// Error classes are already exported above individually
export { AppError as BaseError }; 
