// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/authUtils.js';
import { db } from '../database/client.js';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload & {
        id: string; // Alias for userId for consistency
      };
    }
  }
}

export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let token: string | undefined;

    // Check cookies first (following your pattern)
    if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    } 
    // Then check authorization header
    else if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token required'
      });
    }

    // Verify token
    const decoded = verifyAccessToken(token);

    // Check if user still exists and is active
    const userResult = await db.query(
      `SELECT id, email, global_status FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = userResult.rows[0];

    if (user.global_status === 'BANNED') {
      return res.status(403).json({
        success: false,
        message: 'Account has been suspended'
      });
    }

    // Attach user to request
    req.user = {
      ...decoded,
      id: decoded.userId // Add id alias for consistency
    };

    next();

  } catch (error) {
    if (error instanceof Error && error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }

    console.error('Authentication error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// Role-based authorization middleware
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(req.user.globalStatus)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

// Admin-only middleware
export const requireAdmin = requireRole(['ADMIN']);

// Workspace authorization middleware (will be enhanced in workspace service)
export const requireWorkspaceAccess = (minimumRole: string = 'VIEWER') => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // This will be implemented in the workspace service
    next();
  };
};