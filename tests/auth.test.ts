// tests/auth.test.ts - UPDATED
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../src/database/client.js';
import { AuthService } from '../src/services/authService.js';
import { hashPassword } from '../src/utils/authUtils.js';

describe('Authentication Service', () => {
  let testUserId: string;

  beforeEach(async () => {
    // Clean up and create test user
    try {
      await db.query('DELETE FROM users WHERE email = $1', ['test@example.com']);
    } catch (error) {
      // Table might not exist yet, that's okay
    }
    
    const passwordHash = await hashPassword('testpassword123');
    const result = await db.query(
      `INSERT INTO users (email, password_hash, global_status) 
       VALUES ($1, $2, 'ACTIVE') 
       RETURNING id`,
      ['test@example.com', passwordHash]
    );
    
    testUserId = result.rows[0].id;
  });

  afterEach(async () => {
    try {
      await db.query('DELETE FROM user_devices WHERE user_id = $1', [testUserId]);
      await db.query('DELETE FROM users WHERE id = $1', [testUserId]);
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  });

  describe('validateUserCredentials', () => {
    it('should validate correct credentials', async () => {
      const user = await AuthService.validateUserCredentials('test@example.com', 'testpassword123');
      expect(user).not.toBeNull();
      expect(user?.id).toBe(testUserId);
      expect(user?.email).toBe('test@example.com');
    });

    it('should reject incorrect password', async () => {
      const user = await AuthService.validateUserCredentials('test@example.com', 'wrongpassword');
      expect(user).toBeNull();
    });

    it('should reject non-existent user', async () => {
      const user = await AuthService.validateUserCredentials('nonexistent@example.com', 'testpassword123');
      expect(user).toBeNull();
    });

    it('should reject banned user', async () => {
      await db.query('UPDATE users SET global_status = $1 WHERE id = $2', ['BANNED', testUserId]);
      
      const user = await AuthService.validateUserCredentials('test@example.com', 'testpassword123');
      expect(user).toBeNull();
    });
  });

  describe('user device management', () => {
    it('should create and validate user device', async () => {
      const refreshTokenHash = 'test-refresh-token-hash';
      
      await AuthService.createUserDevice(
        testUserId,
        refreshTokenHash,
        '127.0.0.1',
        'Test Agent'
      );

      const deviceInfo = await AuthService.validateRefreshToken(refreshTokenHash);
      expect(deviceInfo).not.toBeNull();
      expect(deviceInfo?.user.id).toBe(testUserId);
    });

    it('should revoke user device', async () => {
      const refreshTokenHash = 'test-refresh-token-hash';
      
      await AuthService.createUserDevice(
        testUserId,
        refreshTokenHash,
        '127.0.0.1',
        'Test Agent'
      );

      const revoked = await AuthService.revokeUserDevice(refreshTokenHash);
      expect(revoked).toBe(true);

      const deviceInfo = await AuthService.validateRefreshToken(refreshTokenHash);
      expect(deviceInfo).toBeNull();
    });
  });
});