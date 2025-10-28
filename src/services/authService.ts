// src/services/authService.ts
import { db } from '../database/client.js';
import { hashPassword, verifyPassword } from '../utils/authUtils.js';
import { logAuth } from '../services/logger.js';

export class AuthService {
  static async validateUserCredentials(email: string, password: string): Promise<any> {
    try {
      const result = await db.query(
        `SELECT id, email, password_hash, global_status 
         FROM users WHERE email = $1`,
        [email.toLowerCase()]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const user = result.rows[0];

      // Check if user is banned
      if (user.global_status === 'BANNED') {
        return null;
      }

      // Verify password
      const isPasswordValid = await verifyPassword(password, user.password_hash);
      
      if (!isPasswordValid) {
        return null;
      }

      return {
        id: user.id,
        email: user.email,
        globalStatus: user.global_status
      };

    } catch (error) {
      console.error('AuthService - validateUserCredentials error:', error);
      throw error;
    }
  }

  static async updateLastLogin(userId: string): Promise<void> {
    try {
      await db.query(
        `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`,
        [userId]
      );
    } catch (error) {
      console.error('AuthService - updateLastLogin error:', error);
      throw error;
    }
  }

  static async createUserDevice(
    userId: string, 
    refreshTokenHash: string, 
    ipAddress: string, 
    userAgent: string
  ): Promise<void> {
    try {
      await db.query(
        `INSERT INTO user_devices (user_id, refresh_token_hash, ip_address, user_agent)
         VALUES ($1, $2, $3, $4)`,
        [userId, refreshTokenHash, ipAddress, userAgent]
      );
    } catch (error) {
      console.error('AuthService - createUserDevice error:', error);
      throw error;
    }
  }

  static async revokeUserDevice(refreshTokenHash: string): Promise<boolean> {
    try {
      const result = await db.query(
        `UPDATE user_devices SET is_revoked = true WHERE refresh_token_hash = $1`,
        [refreshTokenHash]
      );
      
      return result.rowCount > 0;
    } catch (error) {
      console.error('AuthService - revokeUserDevice error:', error);
      throw error;
    }
  }

  static async revokeAllUserDevices(userId: string, excludeRefreshTokenHash?: string): Promise<number> {
    try {
      let query = `UPDATE user_devices SET is_revoked = true WHERE user_id = $1`;
      const params: any[] = [userId];

      if (excludeRefreshTokenHash) {
        query += ` AND refresh_token_hash != $2`;
        params.push(excludeRefreshTokenHash);
      }

      const result = await db.query(query, params);
      return result.rowCount || 0;
    } catch (error) {
      console.error('AuthService - revokeAllUserDevices error:', error);
      throw error;
    }
  }

  static async getUserDevices(userId: string): Promise<any[]> {
    try {
      const result = await db.query(
        `SELECT id, ip_address, user_agent, device_info, login_time, is_revoked, last_active
         FROM user_devices 
         WHERE user_id = $1 
         ORDER BY last_active DESC`,
        [userId]
      );

      return result.rows;
    } catch (error) {
      console.error('AuthService - getUserDevices error:', error);
      throw error;
    }
  }

  static async validateRefreshToken(refreshTokenHash: string): Promise<any> {
    try {
      const result = await db.query(`
        SELECT ud.*, u.email, u.global_status 
        FROM user_devices ud 
        JOIN users u ON ud.user_id = u.id 
        WHERE ud.refresh_token_hash = $1 AND ud.is_revoked = false
      `, [refreshTokenHash]);

      if (result.rows.length === 0) {
        return null;
      }

      const device = result.rows[0];
      
      // Check if user is banned
      if (device.global_status === 'BANNED') {
        return null;
      }

      return {
        device: {
          id: device.id,
          ipAddress: device.ip_address,
          userAgent: device.user_agent
        },
        user: {
          id: device.user_id,
          email: device.email,
          globalStatus: device.global_status
        }
      };

    } catch (error) {
      console.error('AuthService - validateRefreshToken error:', error);
      throw error;
    }
  }

  static async updateDeviceRefreshToken(
    deviceId: string, 
    newRefreshTokenHash: string
  ): Promise<void> {
    try {
      await db.query(
        `UPDATE user_devices 
         SET refresh_token_hash = $1, last_active = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [newRefreshTokenHash, deviceId]
      );
    } catch (error) {
      console.error('AuthService - updateDeviceRefreshToken error:', error);
      throw error;
    }
  }

  static async changePassword(userId: string, newPassword: string): Promise<void> {
    try {
      const newPasswordHash = await hashPassword(newPassword);
      
      await db.query(
        `UPDATE users SET password_hash = $1 WHERE id = $2`,
        [newPasswordHash, userId]
      );

      // Revoke all devices except current one for security
      // This would be implemented when you have the current device context

    } catch (error) {
      console.error('AuthService - changePassword error:', error);
      throw error;
    }
  }

  static async getUserById(userId: string): Promise<any> {
    try {
      const result = await db.query(
        `SELECT id, email, global_status, created_at, updated_at, last_login 
         FROM users WHERE id = $1`,
        [userId]
      );

      return result.rows[0] ? {
        ...result.rows[0],
        globalStatus: result.rows[0].global_status
      } : null;
    } catch (error) {
      console.error('AuthService - getUserById error:', error);
      throw error;
    }
  }

  static async isUserAdmin(userId: string): Promise<boolean> {
    try {
      const result = await db.query(
        `SELECT global_status FROM users WHERE id = $1`,
        [userId]
      );

      return result.rows.length > 0 && result.rows[0].global_status === 'ADMIN';
    } catch (error) {
      console.error('AuthService - isUserAdmin error:', error);
      throw error;
    }
  }
}