// src/graphql/resolvers.ts - Fixed for Apollo Server 4
import { GraphQLError } from 'graphql';
import { db } from '../database/client.js';
import { hashPassword, verifyPassword, generateResetToken, hashResetToken, generateTokens, setTokenCookies, TokenPayload } from '../utils/authUtils.js';
import { WorkspaceService } from '../services/workspaceService.js';
import { ProjectService } from '../services/projectService.js';
import { TaskService } from '../services/taskService.js';
import { NotificationService } from '../services/notificationService.js';
import { AIService } from '../services/aiService.js';
import { logger } from '../services/logger.js';
import { PubSub } from 'graphql-subscriptions';

const pubsub = new PubSub();

// Custom error classes for Apollo Server 4
class AuthenticationError extends GraphQLError {
  constructor(message: string) {
    super(message, {
      extensions: { code: 'UNAUTHENTICATED' }
    });
  }
}

class ForbiddenError extends GraphQLError {
  constructor(message: string) {
    super(message, {
      extensions: { code: 'FORBIDDEN' }
    });
  }
}

class UserInputError extends GraphQLError {
  constructor(message: string) {
    super(message, {
      extensions: { code: 'BAD_USER_INPUT' }
    });
  }
}

export const resolvers = {
  // Scalars
  DateTime: {
    serialize: (value: any) => {
      if (value instanceof Date) {
        return value.toISOString();
      }
      return value;
    },
    parseValue: (value: any) => new Date(value),
    parseLiteral: (ast: any) => {
      if (ast.kind === 'StringValue') {
        return new Date(ast.value);
      }
      return null;
    }
  },

  JSON: {
    serialize: (value: any) => value,
    parseValue: (value: any) => value,
    parseLiteral: (ast: any) => {
      switch (ast.kind) {
        case 'StringValue': 
          try {
            return JSON.parse(ast.value);
          } catch {
            return ast.value;
          }
        case 'IntValue':
          return parseInt(ast.value, 10);
        case 'FloatValue':
          return parseFloat(ast.value);
        case 'BooleanValue':
          return ast.value;
        case 'ObjectValue':
          const obj: any = {};
          ast.fields.forEach((field: any) => {
            obj[field.name.value] = field.value.value;
          });
          return obj;
        default:
          return null;
      }
    }
  },

  // Query Resolvers
  Query: {
    // Auth
    me: async (_: any, __: any, context: any) => {
      if (!context.user) {
        throw new AuthenticationError('Authentication required');
      }

      const result = await db.query(
        `SELECT id, email, global_status, created_at, updated_at, last_login 
         FROM users WHERE id = $1`,
        [context.user.userId]
      );

      return result.rows[0] ? {
        ...result.rows[0],
        globalStatus: result.rows[0].global_status
      } : null;
    },

    // Workspaces
    workspace: async (_: any, { id }: { id: string }, context: any) => {
    if (!context.user) throw new AuthenticationError('Authentication required');
    
    try {
      const workspace = await WorkspaceService.getWorkspace(id, context.user.userId);
      if (!workspace) {
        throw new UserInputError('Workspace not found or access denied');
      }
      return workspace;
    } catch (error) {
      if (error instanceof ForbiddenError || error instanceof UserInputError) {
        throw error;
      }
      console.error('Workspace query error:', error);
      throw new Error('Failed to fetch workspace');
    }
  },

  myWorkspaces: async (_: any, __: any, context: any) => {
    if (!context.user) throw new AuthenticationError('Authentication required');
    
    try {
      return await WorkspaceService.getUserWorkspaces(context.user.userId);
    } catch (error) {
      console.error('MyWorkspaces query error:', error);
      throw new Error('Failed to fetch workspaces');
    }
  },

  getAllWorkspaces: async (_: any, __: any, context: any) => {
    if (!context.user) throw new AuthenticationError('Authentication required');

    try {
      // Check if user is admin
      const userResult = await db.query(
        `SELECT global_status FROM users WHERE id = $1`,
        [context.user.userId]
      );

      if (userResult.rows.length === 0 || userResult.rows[0].global_status !== 'ADMIN') {
        throw new ForbiddenError('Admin access required');
      }

      const result = await db.query(`
        SELECT w.*, u.email as created_by_email 
        FROM workspaces w 
        JOIN users u ON w.created_by = u.id 
        ORDER BY w.created_at DESC
      `);

      return result.rows.map(row => ({
        ...row,
        createdBy: { 
          id: row.created_by, 
          email: row.created_by_email 
        },
        // Ensure members are included
        members: []
      }));
    } catch (error) {
      console.error('GetAllWorkspaces query error:', error);
      throw error;
    }
  },

  // Audit Logs
    getAuditLogs: async (_: any, { level, userId, startDate, endDate, limit = 50 }: any, context: any) => {
      if (!context.user) {
        throw new AuthenticationError('Authentication required');
      }

      // Check if user is admin
      const userResult = await db.query(
        `SELECT global_status FROM users WHERE id = $1`,
        [context.user.userId]
      );

      if (userResult.rows.length === 0 || userResult.rows[0].global_status !== 'ADMIN') {
        throw new ForbiddenError('Admin access required');
      }

      let query = `SELECT * FROM audit_logs WHERE 1=1`;
      const params: any[] = [];
      let paramCount = 0;

      if (level) {
        paramCount++;
        query += ` AND level = $${paramCount}`;
        params.push(level);
      }

      if (userId) {
        paramCount++;
        query += ` AND user_id = $${paramCount}`;
        params.push(userId);
      }

      if (startDate) {
        paramCount++;
        query += ` AND timestamp >= $${paramCount}`;
        params.push(new Date(startDate));
      }

      if (endDate) {
        paramCount++;
        query += ` AND timestamp <= $${paramCount}`;
        params.push(new Date(endDate));
      }

      query += ` ORDER BY timestamp DESC LIMIT $${paramCount + 1}`;
      params.push(limit);

      const result = await db.query(query, params);
      return result.rows;
    },

    // Projects
    project: async (_: any, { id }: { id: string }, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return ProjectService.getProject(id, context.user.userId);
    },

    workspaceProjects: async (_: any, { workspaceId }: { workspaceId: string }, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return ProjectService.getWorkspaceProjects(workspaceId, context.user.userId);
    },

    // Tasks
    task: async (_: any, { id }: { id: string }, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return TaskService.getTask(id, context.user.userId);
    },

    projectTasks: async (_: any, { projectId }: { projectId: string }, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return TaskService.getProjectTasks(projectId, context.user.userId);
    },

    myAssignedTasks: async (_: any, { status }: { status?: string }, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return TaskService.getUserAssignedTasks(context.user.userId, status);
    },

    // Notifications
    myNotifications: async (_: any, { status }: { status?: string }, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return NotificationService.getUserNotifications(context.user.userId, status);
    },

    unreadNotificationCount: async (_: any, __: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return NotificationService.getUnreadCount(context.user.userId);
    },

    // AI Features
    summarizeTask: async (_: any, { input }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return AIService.summarizeTask(input.taskDescription);
    },

    // Workspace members
    workspaceMembers: async (_: any, { workspaceId }: { workspaceId: string }, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return WorkspaceService.getWorkspaceMembers(workspaceId, context.user.userId);
    },

    // Project members
    projectMembers: async (_: any, { projectId }: { projectId: string }, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return ProjectService.getProjectMembers(projectId, context.user.userId);
    },
  },

  // Mutation Resolvers
  Mutation: {
    // Authentication
    register: async (_: any, { input }: any, context: any) => {
      try {
        const { email, password } = input;
        
        // Check if user already exists
        const existingUser = await db.query(
          `SELECT id FROM users WHERE email = $1`,
          [email.toLowerCase()]
        );

        if (existingUser.rows.length > 0) {
          throw new UserInputError('User already exists with this email');
        }

        // Hash password and create user
        const passwordHash = await hashPassword(password);
        const result = await db.query(
          `INSERT INTO users (email, password_hash, global_status) 
           VALUES ($1, $2, 'ACTIVE') 
           RETURNING id, email, global_status, created_at`,
          [email.toLowerCase(), passwordHash]
        );

        const user = result.rows[0];
        
        // Generate tokens
        const tokenPayload: TokenPayload = {
          userId: user.id,
          email: user.email,
          globalStatus: user.global_status
        };

        const tokens = generateTokens(tokenPayload);
        setTokenCookies(context.res, tokens);

        await logger.info('REGISTER_SUCCESS', { email }, user.id, context.req?.ip);

        return {
          ...tokens,
          user: {
            id: user.id,
            email: user.email,
            globalStatus: user.global_status
          }
        };

      } catch (error) {
        await logger.error('REGISTER_FAILED', { 
          email: input.email, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        }, undefined, context.req?.ip);
        throw error;
      }
    },

    forgotPassword: async (_: any, { input }: any, context: any) => {
      try {
        const { email } = input;
        
        const userResult = await db.query(
          `SELECT id FROM users WHERE email = $1`,
          [email.toLowerCase()]
        );

        if (userResult.rows.length === 0) {
          // Don't reveal whether user exists for security
          return true;
        }

        const user = userResult.rows[0];
        const resetToken = generateResetToken();
        const resetTokenHash = hashResetToken(resetToken);
        
        await logger.info('PASSWORD_RESET_REQUEST', { email }, user.id, context.req?.ip);
        
        console.log(`Password reset token for ${email}: ${resetToken}`);
        // In production, send email with reset token
        
        return true;

      } catch (error) {
        await logger.error('PASSWORD_RESET_REQUEST_FAILED', { 
          email: input.email,
          error: error instanceof Error ? error.message : 'Unknown error' 
        }, undefined, context.req?.ip);
        throw error;
      }
    },

    updatePassword: async (_: any, { input }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');

      try {
        const { currentPassword, newPassword } = input;
        const userId = context.user.userId;

        // Verify current password
        const userResult = await db.query(
          `SELECT password_hash FROM users WHERE id = $1`,
          [userId]
        );

        if (userResult.rows.length === 0) {
          throw new AuthenticationError('User not found');
        }

        const isCurrentPasswordValid = await verifyPassword(
          currentPassword, 
          userResult.rows[0].password_hash
        );

        if (!isCurrentPasswordValid) {
          throw new UserInputError('Current password is incorrect');
        }

        // Update password
        const newPasswordHash = await hashPassword(newPassword);
        await db.query(
          `UPDATE users SET password_hash = $1 WHERE id = $2`,
          [newPasswordHash, userId]
        );

        await logger.info('PASSWORD_UPDATED', {}, userId, context.req?.ip);

        return true;

      } catch (error) {
        await logger.error('PASSWORD_UPDATE_FAILED', {
          error: error instanceof Error ? error.message : 'Unknown error'
        }, context.user.userId, context.req?.ip);
        throw error;
      }
    },

    // Admin mutations
    userBan: async (_: any, { userId }: { userId: string }, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');

      // Check if requester is admin
      const requesterResult = await db.query(
        `SELECT global_status FROM users WHERE id = $1`,
        [context.user.userId]
      );

      if (requesterResult.rows.length === 0 || requesterResult.rows[0].global_status !== 'ADMIN') {
        throw new ForbiddenError('Admin access required');
      }

      await db.query(
        `UPDATE users SET global_status = 'BANNED' WHERE id = $1`,
        [userId]
      );

      const userResult = await db.query(
        `SELECT id, email, global_status FROM users WHERE id = $1`,
        [userId]
      );

      await logger.info('USER_BANNED', 
        { targetUserId: userId }, 
        context.user.userId, 
        context.req?.ip
      );

      return userResult.rows[0] ? {
        ...userResult.rows[0],
        globalStatus: userResult.rows[0].global_status
      } : null;
    },

    userUnban: async (_: any, { userId }: { userId: string }, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');

      // Check if requester is admin
      const requesterResult = await db.query(
        `SELECT global_status FROM users WHERE id = $1`,
        [context.user.userId]
      );

      if (requesterResult.rows.length === 0 || requesterResult.rows[0].global_status !== 'ADMIN') {
        throw new ForbiddenError('Admin access required');
      }

      await db.query(
        `UPDATE users SET global_status = 'ACTIVE' WHERE id = $1`,
        [userId]
      );

      const userResult = await db.query(
        `SELECT id, email, global_status FROM users WHERE id = $1`,
        [userId]
      );

      await logger.info('USER_UNBANNED', 
        { targetUserId: userId }, 
        context.user.userId, 
        context.req?.ip
      );

      return userResult.rows[0] ? {
        ...userResult.rows[0],
        globalStatus: userResult.rows[0].global_status
      } : null;
    },

    adminResetPassword: async (_: any, { input }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');

      // Check if requester is admin
      const requesterResult = await db.query(
        `SELECT global_status FROM users WHERE id = $1`,
        [context.user.userId]
      );

      if (requesterResult.rows.length === 0 || requesterResult.rows[0].global_status !== 'ADMIN') {
        throw new ForbiddenError('Admin access required');
      }

      const { userId, newPassword } = input;
      const newPasswordHash = await hashPassword(newPassword);

      await db.query(
        `UPDATE users SET password_hash = $1 WHERE id = $2`,
        [newPasswordHash, userId]
      );

      await logger.info('ADMIN_RESET_PASSWORD', 
        { targetUserId: userId }, 
        context.user.userId, 
        context.req?.ip
      );

      return true;
    },

    // Workspace mutations
    createWorkspace: async (_: any, { input }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return WorkspaceService.createWorkspace(input, context.user.userId, context.req?.ip);
    },

    addWorkspaceMember: async (_: any, { input }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return WorkspaceService.addWorkspaceMember(input, context.user.userId, context.req?.ip);
    },

    removeWorkspaceMember: async (_: any, { workspaceId, userId }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return WorkspaceService.removeWorkspaceMember(workspaceId, userId, context.user.userId, context.req?.ip);
    },

    updateWorkspaceMemberRole: async (_: any, { input }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return WorkspaceService.updateWorkspaceMemberRole(input, context.user.userId, context.req?.ip);
    },

    // Project mutations
    createProject: async (_: any, { input }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return ProjectService.createProject(input, context.user.userId, context.req?.ip);
    },

    updateProjectMemberRole: async (_: any, { input }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return ProjectService.updateProjectMemberRole(input, context.user.userId, context.req?.ip);
    },

    deleteProject: async (_: any, { projectId }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return ProjectService.deleteProject(projectId, context.user.userId, context.req?.ip);
    },

    // Task mutations
    createTask: async (_: any, { input }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return TaskService.createTask(input, context.user.userId, context.req?.ip, pubsub);
    },

    updateTask: async (_: any, { input }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return TaskService.updateTask(input, context.user.userId, context.req?.ip, pubsub);
    },

    deleteTask: async (_: any, { taskId }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return TaskService.deleteTask(taskId, context.user.userId, context.req?.ip);
    },

    // Notification mutations
    markNotificationAsRead: async (_: any, { notificationId }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return NotificationService.markAsRead(notificationId, context.user.userId);
    },

    markAllNotificationsAsRead: async (_: any, __: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return NotificationService.markAllAsRead(context.user.userId);
    },

    deleteNotification: async (_: any, { notificationId }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return NotificationService.deleteNotification(notificationId, context.user.userId);
    },

    // AI mutations
    generateTasksFromPrompt: async (_: any, { input }: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return AIService.generateTasksFromPrompt(input, context.user.userId, context.req?.ip, pubsub);
    }
  },

  // Subscription Resolvers
  Subscription: {
    taskStatusUpdated: {
      subscribe: () => pubsub.asyncIterator(['TASK_STATUS_UPDATED'])
    }
  },

  // Field Resolvers
  Workspace: {
    createdBy: async (workspace: any) => {
      const result = await db.query(
        `SELECT id, email, global_status FROM users WHERE id = $1`,
        [workspace.created_by]
      );
      return result.rows[0] ? {
        ...result.rows[0],
        globalStatus: result.rows[0].global_status
      } : null;
    },

    members: async (workspace: any, _: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return WorkspaceService.getWorkspaceMembers(workspace.id, context.user.userId);
    },

    projects: async (workspace: any, _: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return ProjectService.getWorkspaceProjects(workspace.id, context.user.userId);
    }
  },

  Project: {
    workspace: async (project: any) => {
      const result = await db.query(
        `SELECT * FROM workspaces WHERE id = $1`,
        [project.workspace_id]
      );
      return result.rows[0] ? {
        ...result.rows[0],
        createdBy: { id: result.rows[0].created_by }
      } : null;
    },

    createdBy: async (project: any) => {
      const result = await db.query(
        `SELECT id, email, global_status FROM users WHERE id = $1`,
        [project.created_by]
      );
      return result.rows[0] ? {
        ...result.rows[0],
        globalStatus: result.rows[0].global_status
      } : null;
    },

    members: async (project: any, _: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return ProjectService.getProjectMembers(project.id, context.user.userId);
    },

    tasks: async (project: any, _: any, context: any) => {
      if (!context.user) throw new AuthenticationError('Authentication required');
      return TaskService.getProjectTasks(project.id, context.user.userId);
    }
  },

  Task: {
    project: async (task: any) => {
      const result = await db.query(
        `SELECT * FROM projects WHERE id = $1`,
        [task.project_id]
      );
      return result.rows[0];
    },

    createdBy: async (task: any) => {
      const result = await db.query(
        `SELECT id, email, global_status FROM users WHERE id = $1`,
        [task.created_by]
      );
      return result.rows[0] ? {
        ...result.rows[0],
        globalStatus: result.rows[0].global_status
      } : null;
    },

    assignedTo: async (task: any) => {
      const result = await db.query(`
        SELECT u.id, u.email, u.global_status 
        FROM task_assignments ta 
        JOIN users u ON ta.user_id = u.id 
        WHERE ta.task_id = $1
      `, [task.id]);

      return result.rows.map((row: any) => ({
        ...row,
        globalStatus: row.global_status
      }));
    }
  }
};