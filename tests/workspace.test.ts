// tests/workspace.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../src/database/client.js';
import { WorkspaceService } from '../src/services/workspaceService.js';
import { hashPassword } from '../src/utils/authUtils.js';

describe('Workspace Service', () => {
  let ownerId: string;
  let memberId: string;
  let workspaceId: string;

  beforeEach(async () => {
    // Clean up and create test users
    await db.query('DELETE FROM users WHERE email LIKE $1', ['test%@example.com']);
    
    const ownerPasswordHash = await hashPassword('password123');
    const ownerResult = await db.query(
      `INSERT INTO users (email, password_hash, global_status) 
       VALUES ($1, $2, 'ACTIVE') 
       RETURNING id`,
      ['owner@example.com', ownerPasswordHash]
    );
    ownerId = ownerResult.rows[0].id;

    const memberPasswordHash = await hashPassword('password123');
    const memberResult = await db.query(
      `INSERT INTO users (email, password_hash, global_status) 
       VALUES ($1, $2, 'ACTIVE') 
       RETURNING id`,
      ['member@example.com', memberPasswordHash]
    );
    memberId = memberResult.rows[0].id;
  });

  afterEach(async () => {
    if (workspaceId) {
      await db.query('DELETE FROM workspace_members WHERE workspace_id = $1', [workspaceId]);
      await db.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    }
    await db.query('DELETE FROM users WHERE id IN ($1, $2)', [ownerId, memberId]);
  });

  describe('createWorkspace', () => {
    it('should create workspace and make creator owner', async () => {
      const workspace = await WorkspaceService.createWorkspace(
        { name: 'Test Workspace', description: 'Test Description' },
        ownerId
      );

      workspaceId = workspace.id;

      expect(workspace.name).toBe('Test Workspace');
      expect(workspace.description).toBe('Test Description');
      expect(workspace.createdBy.id).toBe(ownerId);

      // Verify creator is owner
      const memberRole = await WorkspaceService.getWorkspaceMemberRole(workspaceId, ownerId);
      expect(memberRole).toBe('OWNER');
    });
  });

  describe('workspace membership', () => {
    beforeEach(async () => {
      const workspace = await WorkspaceService.createWorkspace(
        { name: 'Test Workspace', description: 'Test Description' },
        ownerId
      );
      workspaceId = workspace.id;
    });

    it('should add member to workspace', async () => {
      const member = await WorkspaceService.addWorkspaceMember(
        { workspaceId, userId: memberId, role: 'MEMBER' },
        ownerId
      );

      expect(member.user.id).toBe(memberId);
      expect(member.role).toBe('MEMBER');

      const hasAccess = await WorkspaceService.hasWorkspaceAccess(workspaceId, memberId, 'MEMBER');
      expect(hasAccess).toBe(true);
    });

    it('should prevent non-owners from adding members', async () => {
      try {
        await WorkspaceService.addWorkspaceMember(
          { workspaceId, userId: memberId, role: 'MEMBER' },
          memberId // Not the owner
        );
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should update member role', async () => {
      await WorkspaceService.addWorkspaceMember(
        { workspaceId, userId: memberId, role: 'MEMBER' },
        ownerId
      );

      const updatedMember = await WorkspaceService.updateWorkspaceMemberRole(
        { workspaceId, userId: memberId, role: 'VIEWER' },
        ownerId
      );

      expect(updatedMember.role).toBe('VIEWER');
    });
  });
});