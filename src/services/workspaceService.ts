// src/services/workspaceService.ts - COMPLETE AND FIXED
import { db } from '../database/client.js';
import { logger } from './logger.js';

// Custom error classes for services
class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserInputError';
  }
}

export class WorkspaceService {
  static async createWorkspace(input: any, userId: string, ipAddress?: string): Promise<any> {
    try {
      const { name, description } = input;

      if (!name || name.trim().length === 0) {
        throw new UserInputError('Workspace name is required');
      }

      // Start transaction
      const result = await db.transaction(async (client) => {
        // Create workspace
        const workspaceResult = await client.query(
          `INSERT INTO workspaces (name, description, created_by) 
           VALUES ($1, $2, $3) 
           RETURNING *`,
          [name.trim(), description?.trim() || null, userId]
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

      await logger.info('WORKSPACE_CREATED', { workspaceId: result.id, name }, userId, ipAddress);

      return {
        id: result.id,
        name: result.name,
        description: result.description,
        createdAt: result.created_at,
        updatedAt: result.updated_at,
        createdBy: { id: userId }
      };

    } catch (error) {
      console.error('WorkspaceService - createWorkspace error:', error);
      
      if (error instanceof UserInputError) {
        throw error;
      }
      
      // Handle database errors
      if (error instanceof Error && error.message.includes('unique constraint')) {
        throw new UserInputError('A workspace with this name already exists');
      }
      
      throw new Error('Failed to create workspace');
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
        `SELECT w.*, u.email as created_by_email
         FROM workspaces w
         LEFT JOIN users u ON w.created_by = u.id
         WHERE w.id = $1`,
        [workspaceId]
      );

      if (workspaceResult.rows.length === 0) {
        return null;
      }

      const workspace = workspaceResult.rows[0];
      
      return {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        createdAt: workspace.created_at,
        updatedAt: workspace.updated_at,
        createdBy: { 
          id: workspace.created_by,
          email: workspace.created_by_email
        }
      };

    } catch (error) {
      console.error('WorkspaceService - getWorkspace error:', error);
      throw new Error('Failed to fetch workspace');
    }
  }

  static async getUserWorkspaces(userId: string): Promise<any[]> {
    try {
      const result = await db.query(`
        SELECT 
          w.*,
          u.email as created_by_email,
          COUNT(DISTINCT wm.id) as member_count,
          COUNT(DISTINCT p.id) as project_count
        FROM workspaces w 
        JOIN workspace_members wm ON w.id = wm.workspace_id 
        LEFT JOIN users u ON w.created_by = u.id
        LEFT JOIN projects p ON w.id = p.workspace_id
        WHERE wm.user_id = $1 
        GROUP BY w.id, u.email
        ORDER BY w.created_at DESC
      `, [userId]);

      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        createdBy: { 
          id: row.created_by,
          email: row.created_by_email
        },
        memberCount: parseInt(row.member_count),
        projectCount: parseInt(row.project_count)
      }));

    } catch (error) {
      console.error('WorkspaceService - getUserWorkspaces error:', error);
      throw new Error('Failed to fetch workspaces');
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
        `SELECT id, email FROM users WHERE id = $1`,
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

      await logger.info('MEMBER_ADDED', 
        { workspaceId, targetUserId: userId, role }, 
        requesterId, 
        ipAddress
      );

      return {
        id: result.rows[0].id,
        user: { 
          id: userId,
          email: userResult.rows[0].email
        },
        role: result.rows[0].role,
        joinedAt: result.rows[0].created_at
      };

    } catch (error) {
      console.error('WorkspaceService - addWorkspaceMember error:', error);
      
      if (error instanceof ForbiddenError || error instanceof UserInputError) {
        throw error;
      }
      
      throw new Error('Failed to add workspace member');
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

      await logger.info('MEMBER_REMOVED', 
        { workspaceId, targetUserId: userId }, 
        requesterId, 
        ipAddress
      );

      return true;

    } catch (error) {
      console.error('WorkspaceService - removeWorkspaceMember error:', error);
      
      if (error instanceof ForbiddenError || error instanceof UserInputError) {
        throw error;
      }
      
      throw new Error('Failed to remove workspace member');
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

      // Get user email for response
      const userResult = await db.query(
        `SELECT email FROM users WHERE id = $1`,
        [userId]
      );

      await logger.info('ROLE_UPDATED', 
        { workspaceId, targetUserId: userId, newRole: role }, 
        requesterId, 
        ipAddress
      );

      return {
        id: result.rows[0].id,
        user: { 
          id: userId,
          email: userResult.rows[0].email
        },
        role: result.rows[0].role,
        joinedAt: result.rows[0].created_at
      };

    } catch (error) {
      console.error('WorkspaceService - updateWorkspaceMemberRole error:', error);
      
      if (error instanceof ForbiddenError || error instanceof UserInputError) {
        throw error;
      }
      
      throw new Error('Failed to update member role');
    }
  }

  static async hasWorkspaceAccess(workspaceId: string, userId: string, minimumRole: string = 'VIEWER'): Promise<boolean> {
    try {
      const roleHierarchy: Record<string, number> = {
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

  static async getWorkspaceMembers(workspaceId: string, requesterId: string): Promise<any[]> {
    try {
      // Verify requester has access to workspace
      const hasAccess = await this.hasWorkspaceAccess(workspaceId, requesterId, 'VIEWER');
      if (!hasAccess) {
        throw new ForbiddenError('Access to workspace denied');
      }

      const result = await db.query(`
        SELECT 
          wm.*, 
          u.email, 
          u.global_status, 
          u.created_at as user_created
        FROM workspace_members wm 
        JOIN users u ON wm.user_id = u.id 
        WHERE wm.workspace_id = $1 
        ORDER BY 
          CASE wm.role 
            WHEN 'OWNER' THEN 1 
            WHEN 'MEMBER' THEN 2 
            WHEN 'VIEWER' THEN 3 
          END,
          wm.created_at
      `, [workspaceId]);

      return result.rows.map(row => ({
        id: row.id,
        user: {
          id: row.user_id,
          email: row.email,
          globalStatus: row.global_status,
          createdAt: row.user_created
        },
        role: row.role,
        joinedAt: row.created_at
      }));

    } catch (error) {
      console.error('WorkspaceService - getWorkspaceMembers error:', error);
      
      if (error instanceof ForbiddenError) {
        throw error;
      }
      
      throw new Error('Failed to fetch workspace members');
    }
  }

  // Get workspace statistics
  static async getWorkspaceStats(workspaceId: string, userId: string): Promise<any> {
    try {
      const hasAccess = await this.hasWorkspaceAccess(workspaceId, userId, 'VIEWER');
      if (!hasAccess) {
        throw new ForbiddenError('Access to workspace denied');
      }

      const statsResult = await db.query(`
        SELECT 
          COUNT(DISTINCT wm.user_id) as member_count,
          COUNT(DISTINCT p.id) as project_count,
          COUNT(DISTINCT t.id) as task_count,
          COUNT(DISTINCT CASE WHEN t.status = 'DONE' THEN t.id END) as completed_tasks
        FROM workspaces w
        LEFT JOIN workspace_members wm ON w.id = wm.workspace_id
        LEFT JOIN projects p ON w.id = p.workspace_id
        LEFT JOIN tasks t ON p.id = t.project_id
        WHERE w.id = $1
      `, [workspaceId]);

      return statsResult.rows[0] || {
        member_count: 0,
        project_count: 0,
        task_count: 0,
        completed_tasks: 0
      };

    } catch (error) {
      console.error('WorkspaceService - getWorkspaceStats error:', error);
      throw new Error('Failed to fetch workspace statistics');
    }
  }
}