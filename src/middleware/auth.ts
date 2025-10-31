// src/middleware/auth.ts - FIXED for public GraphQL operations
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/authUtils.js';
import { AuthService } from '../services/authService.js';
import { logger } from '../services/logger.js';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload & {
        id: string;
      };
    }
  }
}

export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Skip authentication for specific GraphQL operations
    if (req.path === '/graphql' && req.body) {
      const { operationName, query } = req.body;
      
      // Allow login and register mutations without authentication
      if (operationName === 'Login' || operationName === 'Register' || 
          (query && (
            query.includes('mutation Login') || 
            query.includes('mutation Register') ||
            query.includes('__schema') || // Introspection queries
            query.includes('IntrospectionQuery')
          ))) {
        logger.debug('Skipping authentication for public GraphQL operation', { 
          operationName, 
          path: req.path 
        });
        return next();
      }
    }

    // Skip authentication for REST auth endpoints
    if (req.path.startsWith('/api/auth/login') || req.path.startsWith('/api/auth/register')) {
      return next();
    }

    let token: string | undefined;

    // Check cookies first
    if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    } 
    // Then check authorization header
    else if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      logger.warn('Authentication failed: no token provided', { ip: req.ip, path: req.path });
      res.status(401).json({
        success: false,
        message: 'Authentication token required'
      });
      return;
    }

    // Verify token
    const decoded = verifyAccessToken(token);

    // Check if user still exists and is active
    const user = await AuthService.getUserById(decoded.userId);

    if (!user) {
      logger.warn('Authentication failed: user not found', { userId: decoded.userId, ip: req.ip });
      res.status(401).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    if (user.globalStatus === 'BANNED') {
      logger.warn('Authentication failed: user banned', { userId: decoded.userId, ip: req.ip });
      res.status(403).json({
        success: false,
        message: 'Account has been suspended'
      });
      return;
    }

    // Attach user to request
    req.user = {
      ...decoded,
      id: decoded.userId
    };

    logger.debug('Authentication successful', { userId: decoded.userId, ip: req.ip });

    next();

  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Invalid access token')) {
        logger.warn('Authentication failed: invalid token', { ip: req.ip });
        res.status(401).json({
          success: false,
          message: 'Invalid token'
        });
        return;
      }

      if (error.message.includes('Access token expired')) {
        logger.warn('Authentication failed: token expired', { ip: req.ip });
        res.status(401).json({
          success: false,
          message: 'Token expired'
        });
        return;
      }
    }

    logger.error('Authentication error', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      ip: req.ip 
    });

    res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
    return;
  }
};

// Role-based authorization middleware
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Fix: Check if globalStatus exists before using it
    if (!req.user.globalStatus || !allowedRoles.includes(req.user.globalStatus)) {
      logger.warn('Authorization failed: insufficient permissions', { 
        userId: req.user.userId, 
        role: req.user.globalStatus,
        requiredRoles: allowedRoles,
        ip: req.ip 
      });
      
      res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
      return;
    }

    next();
  };
};

// Admin-only middleware
export const requireAdmin = requireRole(['ADMIN']);

// Optional authentication middleware (attaches user if available)
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let token: string | undefined;

    if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    } else if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
      const decoded = verifyAccessToken(token);
      const user = await AuthService.getUserById(decoded.userId);
      
      if (user && user.globalStatus !== 'BANNED') {
        req.user = {
          ...decoded,
          id: decoded.userId
        };
      }
    }

    next();
  } catch (error) {
    // Continue without authentication on token errors
    next();
  }
};