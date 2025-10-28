// src/services/workspaceService.ts
import { db } from '../database/client.js';
import { logSystem, logActivity } from '../services/logger.js';
import { ForbiddenError, UserInputError } from 'apollo-server-express';

export class WorkspaceService {
  static async createWorkspace(input: any, userId: string, ipAddress?: string): Promise<any> {
    try {
      const { name, description } = input;

      // Start transaction
      const result = await db.transaction(async (client) => {
        // Create workspace
        const workspaceResult = await client.query(
          `INSERT INTO workspaces (name, description, created_by) 
           VALUES ($1, $2, $3) 
           RETURNING *`,
          [name, description, userId]
        );

        const workspace = workspaceResult.rows[0];

        // Add creator as owner
        await client.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role) 
           VALUES ($1, $2, 'OWNER')`,
          [workspace.id, userId]
        );

        return workspace;
      });

      await logSystem('info', 'WORKSPACE_CREATED', { workspaceId: result.id }, userId, ipAddress);
      await logActivity('WORKSPACE_CREATED', { workspaceId: result.id }, userId, ipAddress);

      return result;

    } catch (error) {
      console.error('WorkspaceService - createWorkspace error:', error);
      throw error;
    }
  }

  static async getWorkspace(workspaceId: string, userId: string): Promise<any> {
    try {
      // Check if user has access to workspace
      const accessResult = await db.query(
        `SELECT role FROM workspace_members 
         WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId]
      );

      if (accessResult.rows.length === 0) {
        return null;
      }

      const workspaceResult = await db.query(
        `SELECT * FROM workspaces WHERE id = $1`,
        [workspaceId]
      );

      return workspaceResult.rows[0];

    } catch (error) {
      console.error('WorkspaceService - getWorkspace error:', error);
      throw error;
    }
  }

  static async getUserWorkspaces(userId: string): Promise<any[]> {
    try {
      const result = await db.query(`
        SELECT w.*, wm.role 
        FROM workspaces w 
        JOIN workspace_members wm ON w.id = wm.workspace_id 
        WHERE wm.user_id = $1 
        ORDER BY w.created_at DESC
      `, [userId]);

      return result.rows;

    } catch (error) {
      console.error('WorkspaceService - getUserWorkspaces error:', error);
      throw error;
    }
  }

  static async addWorkspaceMember(input: any, requesterId: string, ipAddress?: string): Promise<any> {
    try {
      const { workspaceId, userId, role = 'MEMBER' } = input;

      // Verify requester is owner
      const requesterRole = await this.getWorkspaceMemberRole(workspaceId, requesterId);
      if (requesterRole !== 'OWNER') {
        throw new ForbiddenError('Only workspace owners can add members');
      }

      // Check if user is already a member
      const existingMember = await db.query(
        `SELECT id FROM workspace_members 
         WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId]
      );

      if (existingMember.rows.length > 0) {
        throw new UserInputError('User is already a member of this workspace');
      }

      // Verify target user exists
      const userResult = await db.query(
        `SELECT id FROM users WHERE id = $1`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new UserInputError('User not found');
      }

      // Add member
      const result = await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) 
         VALUES ($1, $2, $3) 
         RETURNING *`,
        [workspaceId, userId, role]
      );

      await logSystem('info', 'MEMBER_ADDED', 
        { workspaceId, targetUserId: userId, role }, 
        requesterId, 
        ipAddress
      );

      await logActivity('MEMBER_ADDED', 
        { workspaceId, targetUserId: userId, role }, 
        requesterId, 
        ipAddress
      );

      return {
        id: result.rows[0].id,
        user: { id: userId },
        role: result.rows[0].role,
        joinedAt: result.rows[0].created_at
      };

    } catch (error) {
      console.error('WorkspaceService - addWorkspaceMember error:', error);
      throw error;
    }
  }

  static async removeWorkspaceMember(
    workspaceId: string, 
    userId: string, 
    requesterId: string, 
    ipAddress?: string
  ): Promise<boolean> {
    try {
      // Verify requester is owner
      const requesterRole = await this.getWorkspaceMemberRole(workspaceId, requesterId);
      if (requesterRole !== 'OWNER') {
        throw new ForbiddenError('Only workspace owners can remove members');
      }

      // Cannot remove yourself as owner
      if (userId === requesterId) {
        throw new UserInputError('Cannot remove yourself as workspace owner');
      }

      const result = await db.query(
        `DELETE FROM workspace_members 
         WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId]
      );

      if (result.rowCount === 0) {
        throw new UserInputError('Member not found in workspace');
      }

      await logSystem('info', 'MEMBER_REMOVED', 
        { workspaceId, targetUserId: userId }, 
        requesterId, 
        ipAddress
      );

      await logActivity('MEMBER_REMOVED', 
        { workspaceId, targetUserId: userId }, 
        requesterId, 
        ipAddress
      );

      return true;

    } catch (error) {
      console.error('WorkspaceService - removeWorkspaceMember error:', error);
      throw error;
    }
  }

  static async updateWorkspaceMemberRole(input: any, requesterId: string, ipAddress?: string): Promise<any> {
    try {
      const { workspaceId, userId, role } = input;

      // Verify requester is owner
      const requesterRole = await this.getWorkspaceMemberRole(workspaceId, requesterId);
      if (requesterRole !== 'OWNER') {
        throw new ForbiddenError('Only workspace owners can update member roles');
      }

      // Cannot change owner's role
      const targetRole = await this.getWorkspaceMemberRole(workspaceId, userId);
      if (targetRole === 'OWNER') {
        throw new UserInputError('Cannot change role of workspace owner');
      }

      const result = await db.query(
        `UPDATE workspace_members 
         SET role = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE workspace_id = $2 AND user_id = $3 
         RETURNING *`,
        [role, workspaceId, userId]
      );

      if (result.rowCount === 0) {
        throw new UserInputError('Member not found in workspace');
      }

      await logSystem('info', 'ROLE_UPDATED', 
        { workspaceId, targetUserId: userId, newRole: role }, 
        requesterId, 
        ipAddress
      );

      await logActivity('ROLE_UPDATED', 
        { workspaceId, targetUserId: userId, newRole: role }, 
        requesterId, 
        ipAddress
      );

      return {
        id: result.rows[0].id,
        user: { id: userId },
        role: result.rows[0].role,
        joinedAt: result.rows[0].created_at
      };

    } catch (error) {
      console.error('WorkspaceService - updateWorkspaceMemberRole error:', error);
      throw error;
    }
  }

  static async hasWorkspaceAccess(workspaceId: string, userId: string, minimumRole: string = 'VIEWER'): Promise<boolean> {
    try {
      const roleHierarchy = {
        'VIEWER': 1,
        'MEMBER': 2,
        'OWNER': 3
      };

      const result = await db.query(
        `SELECT role FROM workspace_members 
         WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId]
      );

      if (result.rows.length === 0) {
        return false;
      }

      const userRole = result.rows[0].role;
      return roleHierarchy[userRole] >= roleHierarchy[minimumRole];

    } catch (error) {
      console.error('WorkspaceService - hasWorkspaceAccess error:', error);
      return false;
    }
  }

  static async getWorkspaceMemberRole(workspaceId: string, userId: string): Promise<string | null> {
    try {
      const result = await db.query(
        `SELECT role FROM workspace_members 
         WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId]
      );

      return result.rows.length > 0 ? result.rows[0].role : null;

    } catch (error) {
      console.error('WorkspaceService - getWorkspaceMemberRole error:', error);
      return null;
    }
  }
}