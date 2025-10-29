// tests/e2e/auth-flow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { db } from '../../src/database/client.js';
import { hashPassword } from '../../src/utils/authUtils.js';

describe('Authentication End-to-End Flow', () => {
  let testUserId: string;

  beforeAll(async () => {
    // Setup test user
    const passwordHash = await hashPassword('e2epassword123');
    const result = await db.query(
      `INSERT INTO users (email, password_hash, global_status) 
       VALUES ($1, $2, 'ACTIVE') 
       RETURNING id`,
      ['e2e@example.com', passwordHash]
    );
    testUserId = result.rows[0].id;
  });

  afterAll(async () => {
    await db.query('DELETE FROM user_devices WHERE user_id = $1', [testUserId]);
    await db.query('DELETE FROM users WHERE id = $1', [testUserId]);
  });

  it('should complete full authentication flow', async () => {
    // This would test the complete flow from login to token refresh to logout
    // In a real E2E test, you'd use a test HTTP client to hit your actual endpoints
    
    // For now, we'll test the service layer integration
    const { AuthService } = await import('../../src/services/authService.js');

    // 1. Validate credentials
    const user = await AuthService.validateUserCredentials('e2e@example.com', 'e2epassword123');
    expect(user).not.toBeNull();

    // 2. Create device session
    const refreshTokenHash = 'e2e-test-refresh-token';
    await AuthService.createUserDevice(
      testUserId,
      refreshTokenHash,
      '127.0.0.1',
      'E2E Test Agent'
    );

    // 3. Validate refresh token
    const deviceInfo = await AuthService.validateRefreshToken(refreshTokenHash);
    expect(deviceInfo).not.toBeNull();

    // 4. Update last login
    await AuthService.updateLastLogin(testUserId);

    // 5. Revoke device
    const revoked = await AuthService.revokeUserDevice(refreshTokenHash);
    expect(revoked).toBe(true);

    // 6. Verify device is revoked
    const revokedDeviceInfo = await AuthService.validateRefreshToken(refreshTokenHash);
    expect(revokedDeviceInfo).toBeNull();
  });

  it('should handle workspace creation and access control', async () => {
    const { WorkspaceService } = await import('../../src/services/workspaceService.js');
    
    // Create workspace
    const workspace = await WorkspaceService.createWorkspace(
      { name: 'E2E Test Workspace', description: 'E2E Test' },
      testUserId
    );

    // Verify access
    const hasAccess = await WorkspaceService.hasWorkspaceAccess(workspace.id, testUserId, 'OWNER');
    expect(hasAccess).toBe(true);

    // Cleanup
    await db.query('DELETE FROM workspace_members WHERE workspace_id = $1', [workspace.id]);
    await db.query('DELETE FROM workspaces WHERE id = $1', [workspace.id]);
  });
});