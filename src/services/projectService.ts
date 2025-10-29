// src/services/projectService.ts
import { db } from '../database/client.js';
import { logger } from './logger.js';
import { ForbiddenError, UserInputError } from 'apollo-server-express';
import { WorkspaceService } from './workspaceService.js';

export class ProjectService {
  static async createProject(input: any, userId: string, ipAddress?: string): Promise<any> {
    try {
      const { name, description, workspaceId } = input;

      // Verify user has at least MEMBER role in workspace
      const hasAccess = await WorkspaceService.hasWorkspaceAccess(workspaceId, userId, 'MEMBER');
      if (!hasAccess) {
        throw new ForbiddenError('Insufficient permissions to create project in this workspace');
      }

      const result = await db.transaction(async (client) => {
        // Create project
        const projectResult = await client.query(
          `INSERT INTO projects (name, description, workspace_id, created_by) 
           VALUES ($1, $2, $3, $4) 
           RETURNING *`,
          [name, description, workspaceId, userId]
        );

        const project = projectResult.rows[0];

        // Add creator as PROJECT_LEAD by default
        await client.query(
          `INSERT INTO project_members (project_id, user_id, role) 
           VALUES ($1, $2, 'PROJECT_LEAD')`,
          [project.id, userId]
        );

        return project;
      });

      await logger.info('PROJECT_CREATED', { projectId: result.id, workspaceId }, userId, ipAddress);

      return {
        ...result,
        createdBy: { id: userId },
        workspace: { id: workspaceId }
      };

    } catch (error) {
      logger.error('ProjectService - createProject error:', error);
      throw error;
    }
  }

  static async getProject(projectId: string, userId: string): Promise<any> {
    try {
      // Check if user has access to project via workspace membership
      const projectResult = await db.query(
        `SELECT p.*, wm.role as workspace_role
         FROM projects p
         JOIN workspaces w ON p.workspace_id = w.id
         LEFT JOIN workspace_members wm ON w.id = wm.workspace_id AND wm.user_id = $2
         WHERE p.id = $1`,
        [projectId, userId]
      );

      if (projectResult.rows.length === 0) {
        return null;
      }

      const project = projectResult.rows[0];

      // If user has workspace access but not project membership, auto-add as VIEWER
      if (project.workspace_role && !await this.getProjectMemberRole(projectId, userId)) {
        await db.query(
          `INSERT INTO project_members (project_id, user_id, role) 
           VALUES ($1, $2, 'VIEWER') 
           ON CONFLICT (project_id, user_id) DO NOTHING`,
          [projectId, userId]
        );
      }

      return await this.getProjectById(projectId);

    } catch (error) {
      logger.error('ProjectService - getProject error:', error);
      throw error;
    }
  }

  static async getProjectById(projectId: string): Promise<any> {
    try {
      const result = await db.query(
        `SELECT * FROM projects WHERE id = $1`,
        [projectId]
      );
      
      return result.rows[0] ? {
        ...result.rows[0],
        createdBy: { id: result.rows[0].created_by },
        workspace: { id: result.rows[0].workspace_id }
      } : null;
    } catch (error) {
      logger.error('ProjectService - getProjectById error:', error);
      throw error;
    }
  }

  static async getWorkspaceProjects(workspaceId: string, userId: string): Promise<any[]> {
    try {
      // Verify user has access to workspace
      const hasAccess = await WorkspaceService.hasWorkspaceAccess(workspaceId, userId, 'VIEWER');
      if (!hasAccess) {
        throw new ForbiddenError('Access to workspace denied');
      }

      const result = await db.query(
        `SELECT p.* 
         FROM projects p
         WHERE p.workspace_id = $1
         ORDER BY p.created_at DESC`,
        [workspaceId]
      );

      return result.rows.map(row => ({
        ...row,
        createdBy: { id: row.created_by },
        workspace: { id: row.workspace_id }
      }));

    } catch (error) {
      logger.error('ProjectService - getWorkspaceProjects error:', error);
      throw error;
    }
  }

  static async updateProjectMemberRole(input: any, requesterId: string, ipAddress?: string): Promise<any> {
    try {
      const { projectId, userId, role } = input;

      // Verify requester is PROJECT_LEAD or workspace OWNER
      const requesterProjectRole = await this.getProjectMemberRole(projectId, requesterId);
      const project = await this.getProjectById(projectId);
      
      if (!project) {
        throw new UserInputError('Project not found');
      }

      const isWorkspaceOwner = await WorkspaceService.hasWorkspaceAccess(project.workspace.id, requesterId, 'OWNER');
      const isProjectLead = requesterProjectRole === 'PROJECT_LEAD';

      if (!isProjectLead && !isWorkspaceOwner) {
        throw new ForbiddenError('Only project leads or workspace owners can update project roles');
      }

      // Cannot change role of yourself if you're the only PROJECT_LEAD
      if (userId === requesterId && isProjectLead) {
        const otherLeads = await this.countProjectLeads(projectId, requesterId);
        if (otherLeads === 0) {
          throw new UserInputError('Cannot change your own role as the only project lead');
        }
      }

      const result = await db.query(
        `UPDATE project_members 
         SET role = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE project_id = $2 AND user_id = $3 
         RETURNING *`,
        [role, projectId, userId]
      );

      if (result.rowCount === 0) {
        throw new UserInputError('Member not found in project');
      }

      // Get user email for response
      const userResult = await db.query(
        `SELECT email FROM users WHERE id = $1`,
        [userId]
      );

      await logger.info('PROJECT_ROLE_UPDATED', 
        { projectId, targetUserId: userId, newRole: role }, 
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
      logger.error('ProjectService - updateProjectMemberRole error:', error);
      throw error;
    }
  }

  static async deleteProject(projectId: string, requesterId: string, ipAddress?: string): Promise<boolean> {
    try {
      const project = await this.getProjectById(projectId);
      if (!project) {
        throw new UserInputError('Project not found');
      }

      // Verify requester is PROJECT_LEAD or workspace OWNER
      const requesterProjectRole = await this.getProjectMemberRole(projectId, requesterId);
      const isWorkspaceOwner = await WorkspaceService.hasWorkspaceAccess(project.workspace.id, requesterId, 'OWNER');
      const isProjectLead = requesterProjectRole === 'PROJECT_LEAD';

      if (!isProjectLead && !isWorkspaceOwner) {
        throw new ForbiddenError('Only project leads or workspace owners can delete projects');
      }

      await db.query(
        `DELETE FROM projects WHERE id = $1`,
        [projectId]
      );

      await logger.info('PROJECT_DELETED', { projectId, workspaceId: project.workspace.id }, requesterId, ipAddress);

      return true;

    } catch (error) {
      logger.error('ProjectService - deleteProject error:', error);
      throw error;
    }
  }

  static async getProjectMemberRole(projectId: string, userId: string): Promise<string | null> {
    try {
      const result = await db.query(
        `SELECT role FROM project_members 
         WHERE project_id = $1 AND user_id = $2`,
        [projectId, userId]
      );

      return result.rows.length > 0 ? result.rows[0].role : null;

    } catch (error) {
      logger.error('ProjectService - getProjectMemberRole error:', error);
      return null;
    }
  }

  static async hasProjectAccess(projectId: string, userId: string, minimumRole: string = 'VIEWER'): Promise<boolean> {
    try {
      const roleHierarchy: Record<string, number> = {
  'VIEWER': 1,
  'MEMBER': 2,
  'OWNER': 3
};

      const result = await db.query(
        `SELECT role FROM project_members 
         WHERE project_id = $1 AND user_id = $2`,
        [projectId, userId]
      );

      if (result.rows.length === 0) {
        // Check workspace access
        const project = await this.getProjectById(projectId);
        if (!project) return false;

        return await WorkspaceService.hasWorkspaceAccess(project.workspace.id, userId, 'VIEWER');
      }

      const userRole = result.rows[0].role;
      return roleHierarchy[userRole] >= roleHierarchy[minimumRole];

    } catch (error) {
      logger.error('ProjectService - hasProjectAccess error:', error);
      return false;
    }
  }

  static async getProjectMembers(projectId: string, requesterId: string): Promise<any[]> {
    try {
      // Verify requester has access to project
      const hasAccess = await this.hasProjectAccess(projectId, requesterId, 'VIEWER');
      if (!hasAccess) {
        throw new ForbiddenError('Access to project denied');
      }

      const result = await db.query(`
        SELECT pm.*, u.email, u.global_status, u.created_at as user_created
        FROM project_members pm 
        JOIN users u ON pm.user_id = u.id 
        WHERE pm.project_id = $1 
        ORDER BY 
          CASE pm.role 
            WHEN 'PROJECT_LEAD' THEN 1 
            WHEN 'CONTRIBUTOR' THEN 2 
            WHEN 'VIEWER' THEN 3 
          END,
          pm.created_at
      `, [projectId]);

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
      logger.error('ProjectService - getProjectMembers error:', error);
      throw error;
    }
  }

  private static async countProjectLeads(projectId: string, excludeUserId?: string): Promise<number> {
    try {
      let query = `SELECT COUNT(*) FROM project_members WHERE project_id = $1 AND role = 'PROJECT_LEAD'`;
      const params: any[] = [projectId];

      if (excludeUserId) {
        query += ` AND user_id != $2`;
        params.push(excludeUserId);
      }

      const result = await db.query(query, params);
      return parseInt(result.rows[0].count);
    } catch (error) {
      logger.error('ProjectService - countProjectLeads error:', error);
      return 0;
    }
  }
}