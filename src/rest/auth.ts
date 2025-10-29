// src/rest/auth.ts
import { Router, Request, Response } from 'express';
import { 
  generateTokens, 
  verifyRefreshToken, 
  clearTokens, 
  hashRefreshToken,
  setTokenCookies,
  TokenPayload
} from '../utils/authUtils.js';
import { AuthService } from '../services/authService.js';
import { logger } from '../services/logger.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Login endpoint (REST)
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
    
    logger.info('Login attempt', { email: cleanEmail, ip: req.ip });

    // Validate user credentials
    const user = await AuthService.validateUserCredentials(cleanEmail, password);

    if (!user) {
      logger.warn('Login failed: invalid credentials', { email: cleanEmail, ip: req.ip });
      
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    await AuthService.updateLastLogin(user.id);

    // Generate tokens
    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      globalStatus: user.globalStatus
    };

    const tokens = generateTokens(tokenPayload);

    // Store device session
    const refreshTokenHash = hashRefreshToken(tokens.refreshToken);
    
    await AuthService.createUserDevice(
      user.id,
      refreshTokenHash,
      req.ip || 'unknown',
      req.get('User-Agent') || ''
    );

    // Set HTTP-only cookies
    setTokenCookies(res, tokens);

    // Log successful login
    logger.info('Login successful', { userId: user.id, email: cleanEmail, ip: req.ip });

    // Return response
    res.status(200).json({
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        globalStatus: user.globalStatus
      }
    });

  } catch (error) {
    logger.error('Login error', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      email: req.body.email,
      ip: req.ip
    });

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
      await AuthService.revokeUserDevice(refreshTokenHash);
    }

    // Clear tokens from cookies
    clearTokens(res);

    logger.info('User logged out', { userId, ip: req.ip });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    logger.error('Logout error', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      ip: req.ip
    });
    
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

    // Validate refresh token in database
    const validationResult = await AuthService.validateRefreshToken(refreshTokenHash);

    if (!validationResult) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    const { user, device } = validationResult;

    // Generate new tokens
    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      globalStatus: user.globalStatus
    };

    const newTokens = generateTokens(tokenPayload);

    // Update device with new refresh token
    const newRefreshTokenHash = hashRefreshToken(newTokens.refreshToken);
    await AuthService.updateDeviceRefreshToken(device.id, newRefreshTokenHash);

    // Set new cookies
    setTokenCookies(res, newTokens);

    logger.info('Token refreshed', { userId: user.id, ip: req.ip });

    res.status(200).json({
      success: true,
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken
    });

  } catch (error) {
    logger.error('Refresh token error', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      ip: req.ip
    });

    if (error instanceof Error && (
      error.message.includes('Invalid refresh token') || 
      error.message.includes('Refresh token expired')
    )) {
      return res.status(401).json({
        success: false,
        message: error.message
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
    
    let currentRefreshTokenHash: string | undefined;
    if (currentRefreshToken) {
      currentRefreshTokenHash = hashRefreshToken(currentRefreshToken);
    }

    const revokedCount = await AuthService.revokeAllUserDevices(userId, currentRefreshTokenHash);

    logger.info('All sessions revoked', { 
      userId, 
      sessionsRevoked: revokedCount,
      ip: req.ip 
    });

    res.status(200).json({
      success: true,
      message: `Revoked ${revokedCount} other sessions`,
      sessionsRevoked: revokedCount
    });

  } catch (error) {
    logger.error('Revoke sessions error', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      ip: req.ip
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to revoke sessions'
    });
  }
});

// Get user devices/sessions
router.get('/sessions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const devices = await AuthService.getUserDevices(userId);

    res.status(200).json({
      success: true,
      devices
    });

  } catch (error) {
    logger.error('Get sessions error', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      ip: req.ip
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to get sessions'
    });
  }
});

export default router;