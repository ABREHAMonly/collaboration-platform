// src/rest/auth.ts
import { Router, Request, Response } from 'express';
import { db } from '../database/client.js';
import { 
  generateTokens, 
  verifyRefreshToken, 
  clearTokens, 
  hashRefreshToken,
  verifyPassword,
  TokenPayload
} from '../utils/authUtils.js';
import { AuthService } from '../services/authService.js';
import { logAuth } from '../services/logger.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Login endpoint (REST - following your login pattern)
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    
    console.log('🔐 Login attempt:', { email: cleanEmail, ip: req.ip });

    // Find user
    const userResult = await db.query(
      `SELECT id, email, password_hash, global_status FROM users WHERE email = $1`,
      [cleanEmail]
    );

    if (userResult.rows.length === 0) {
      await logAuth('warn', 'LOGIN_FAILURE', { email: cleanEmail, reason: 'user_not_found' }, undefined, req.ip);
      
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const user = userResult.rows[0];

    // Check if user is banned
    if (user.global_status === 'BANNED') {
      await logAuth('warn', 'LOGIN_FAILURE', { email: cleanEmail, reason: 'user_banned' }, user.id, req.ip);
      
      return res.status(403).json({
        success: false,
        message: 'Account has been suspended'
      });
    }

    // Verify password
    const isPasswordValid = await verifyPassword(password, user.password_hash);
    
    if (!isPasswordValid) {
      await logAuth('warn', 'LOGIN_FAILURE', { email: cleanEmail, reason: 'invalid_password' }, user.id, req.ip);
      
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    await db.query(
      `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`,
      [user.id]
    );

    // Generate tokens
    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      globalStatus: user.global_status
    };

    const { accessToken, refreshToken } = generateTokens(res, tokenPayload);

    // Store device session (following your session pattern)
    const refreshTokenHash = hashRefreshToken(refreshToken);
    
    await db.query(
      `INSERT INTO user_devices (user_id, refresh_token_hash, ip_address, user_agent, device_info)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        user.id,
        refreshTokenHash,
        req.ip,
        req.get('User-Agent') || '',
        JSON.stringify({}) // You can enhance this with device detection
      ]
    );

    // Log successful login
    await logAuth('info', 'LOGIN_SUCCESS', { email: cleanEmail }, user.id, req.ip);

    // Return response following your pattern
    res.status(200).json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        globalStatus: user.global_status
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    
    await logAuth('error', 'LOGIN_FAILURE', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      email: req.body.email 
    }, undefined, req.ip);

    res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.'
    });
  }
});

// Logout endpoint (REST)
router.post('/logout', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
      const refreshTokenHash = hashRefreshToken(refreshToken);
      
      // Revoke the specific device session
      await db.query(
        `UPDATE user_devices SET is_revoked = true WHERE user_id = $1 AND refresh_token_hash = $2`,
        [userId, refreshTokenHash]
      );
    }

    // Clear tokens from cookies
    clearTokens(res);

    await logAuth('info', 'LOGOUT', {}, userId, req.ip);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
});

// Refresh token endpoint (REST)
router.post('/refresh-token', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token required'
      });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    const refreshTokenHash = hashRefreshToken(refreshToken);

    // Check if token exists and is not revoked
    const deviceResult = await db.query(
      `SELECT ud.*, u.email, u.global_status 
       FROM user_devices ud 
       JOIN users u ON ud.user_id = u.id 
       WHERE ud.refresh_token_hash = $1 AND ud.is_revoked = false`,
      [refreshTokenHash]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    const device = deviceResult.rows[0];
    const user = deviceResult.rows[0];

    // Check if user is banned
    if (user.global_status === 'BANNED') {
      return res.status(403).json({
        success: false,
        message: 'Account has been suspended'
      });
    }

    // Generate new tokens
    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      globalStatus: user.global_status
    };

    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokens(res, tokenPayload);

    // Update device with new refresh token
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);
    
    await db.query(
      `UPDATE user_devices 
       SET refresh_token_hash = $1, last_active = CURRENT_TIMESTAMP 
       WHERE id = $2`,
      [newRefreshTokenHash, device.id]
    );

    await logAuth('info', 'REFRESH_TOKEN', {}, user.id, req.ip);

    res.status(200).json({
      success: true,
      accessToken: newAccessToken
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    
    if (error instanceof Error && error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Refresh token expired'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to refresh token'
    });
  }
});

// Revoke all sessions endpoint
router.post('/revoke-all-sessions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const currentRefreshToken = req.cookies.refreshToken;
    const currentRefreshTokenHash = hashRefreshToken(currentRefreshToken);

    // Revoke all sessions except current one
    await db.query(
      `UPDATE user_devices 
       SET is_revoked = true 
       WHERE user_id = $1 AND refresh_token_hash != $2`,
      [userId, currentRefreshTokenHash]
    );

    await logAuth('info', 'REVOKE_ALL_SESSIONS', { sessionsRevoked: true }, userId, req.ip);

    res.status(200).json({
      success: true,
      message: 'All other sessions revoked successfully'
    });

  } catch (error) {
    console.error('Revoke sessions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to revoke sessions'
    });
  }
});

export default router;