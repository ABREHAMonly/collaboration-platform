// src/services/taskService.ts
import { db } from '../database/client.js';
import { logger } from './logger.js';
import { ForbiddenError, UserInputError } from 'apollo-server-express';
import { ProjectService } from './projectService.js';
import { NotificationService } from './notificationService.js';
import { PubSub } from 'graphql-subscriptions';

export class TaskService {
  static async createTask(input: any, userId: string, ipAddress?: string, pubsub?: PubSub): Promise<any> {
    try {
      const { title, description, projectId, assignedToIds = [], dueDate } = input;

      // Verify user has at least CONTRIBUTOR role in project
      const hasAccess = await ProjectService.hasProjectAccess(projectId, userId, 'CONTRIBUTOR');
      if (!hasAccess) {
        throw new ForbiddenError('Insufficient permissions to create tasks in this project');
      }

      // Verify assigned users exist and have project access
      if (assignedToIds.length > 0) {
        for (const assignedUserId of assignedToIds) {
          const hasUserAccess = await ProjectService.hasProjectAccess(projectId, assignedUserId, 'VIEWER');
          if (!hasUserAccess) {
            throw new UserInputError(`User ${assignedUserId} does not have access to this project`);
          }
        }
      }

      const result = await db.transaction(async (client) => {
        // Create task
        const taskResult = await client.query(
          `INSERT INTO tasks (title, description, project_id, created_by, due_date) 
           VALUES ($1, $2, $3, $4, $5) 
           RETURNING *`,
          [title, description, projectId, userId, dueDate]
        );

        const task = taskResult.rows[0];

        // Create task assignments
        for (const assignedUserId of assignedToIds) {
          await client.query(
            `INSERT INTO task_assignments (task_id, user_id) 
             VALUES ($1, $2)`,
            [task.id, assignedUserId]
          );

          // Create notification for assigned user
          await NotificationService.createTaskAssignmentNotification(
            assignedUserId,
            task.id,
            task.title,
            client
          );
        }

        return task;
      });

      await logger.info('TASK_CREATED', { taskId: result.id, projectId }, userId, ipAddress);

      // Get project to get workspace ID for subscription
      const project = await ProjectService.getProjectById(projectId);
      if (pubsub && project) {
        const taskWithRelations = await this.enrichTaskWithRelations(result);
        pubsub.publish(`TASK_STATUS_UPDATED_${project.workspace_id}`, {
          taskStatusUpdated: taskWithRelations
        });
      }

      return await this.enrichTaskWithRelations(result);

    } catch (error) {
      logger.error('TaskService - createTask error:', error);
      throw error;
    }
  }

  static async updateTask(input: any, userId: string, ipAddress?: string, pubsub?: PubSub): Promise<any> {
    try {
      const { taskId, title, description, status, assignedToIds, dueDate } = input;

      // Get current task
      const currentTask = await this.getTaskById(taskId);
      if (!currentTask) {
        throw new UserInputError('Task not found');
      }

      // Verify user has access to update this task
      const canUpdate = await this.canUpdateTask(taskId, userId);
      if (!canUpdate) {
        throw new ForbiddenError('Insufficient permissions to update this task');
      }

      // Build update query dynamically
      const updateFields: string[] = [];
      const updateParams: any[] = [];
      let paramCount = 0;

      if (title !== undefined) {
        paramCount++;
        updateFields.push(`title = $${paramCount}`);
        updateParams.push(title);
      }

      if (description !== undefined) {
        paramCount++;
        updateFields.push(`description = $${paramCount}`);
        updateParams.push(description);
      }

      if (status !== undefined) {
        paramCount++;
        updateFields.push(`status = $${paramCount}`);
        updateParams.push(status);
      }

      if (dueDate !== undefined) {
        paramCount++;
        updateFields.push(`due_date = $${paramCount}`);
        updateParams.push(dueDate);
      }

      if (updateFields.length === 0) {
        throw new UserInputError('No fields to update');
      }

      paramCount++;
      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      updateParams.push(taskId);

      const result = await db.transaction(async (client) => {
        // Update task
        const taskResult = await client.query(
          `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
          updateParams
        );

        const task = taskResult.rows[0];

        // Handle assignment updates if provided
        if (assignedToIds !== undefined) {
          // Get current assignments to compare
          const currentAssignments = await client.query(
            `SELECT user_id FROM task_assignments WHERE task_id = $1`,
            [taskId]
          );
          const currentAssignedIds = currentAssignments.rows.map((row: any) => row.user_id);

          // Remove existing assignments
          await client.query(
            `DELETE FROM task_assignments WHERE task_id = $1`,
            [taskId]
          );

          // Add new assignments
          for (const assignedUserId of assignedToIds) {
            await client.query(
              `INSERT INTO task_assignments (task_id, user_id) 
               VALUES ($1, $2)`,
              [taskId, assignedUserId]
            );

            // Create notification for newly assigned users (not previously assigned)
            if (!currentAssignedIds.includes(assignedUserId)) {
              await NotificationService.createTaskAssignmentNotification(
                assignedUserId,
                taskId,
                task.title,
                client
              );
            }
          }
        }

        return task;
      });

      const updatedTask = await this.enrichTaskWithRelations(result);

      // Log status change if it occurred
      if (status !== undefined && status !== currentTask.status) {
        await logger.info('TASK_STATUS_UPDATE', 
          { taskId, oldStatus: currentTask.status, newStatus: status }, 
          userId, 
          ipAddress
        );

        // Publish subscription update
        const project = await ProjectService.getProjectById(result.project_id);
        if (pubsub && project) {
          pubsub.publish(`TASK_STATUS_UPDATED_${project.workspace_id}`, {
            taskStatusUpdated: updatedTask
          });
        }
      }

      return updatedTask;

    } catch (error) {
      logger.error('TaskService - updateTask error:', error);
      throw error;
    }
  }

  static async deleteTask(taskId: string, userId: string, ipAddress?: string): Promise<boolean> {
    try {
      const task = await this.getTaskById(taskId);
      if (!task) {
        throw new UserInputError('Task not found');
      }

      // Verify user has permission to delete (PROJECT_LEAD or task creator)
      const userRole = await ProjectService.getProjectMemberRole(task.project_id, userId);
      const isProjectLead = userRole === 'PROJECT_LEAD';
      const isTaskCreator = task.created_by === userId;

      if (!isProjectLead && !isTaskCreator) {
        throw new ForbiddenError('Insufficient permissions to delete this task');
      }

      await db.query(
        `DELETE FROM tasks WHERE id = $1`,
        [taskId]
      );

      await logger.info('TASK_DELETED', { taskId, projectId: task.project_id }, userId, ipAddress);

      return true;

    } catch (error) {
      logger.error('TaskService - deleteTask error:', error);
      throw error;
    }
  }

  static async getTask(taskId: string, userId: string): Promise<any> {
    try {
      const task = await this.getTaskById(taskId);
      if (!task) {
        return null;
      }

      // Verify user has project access
      const hasAccess = await ProjectService.hasProjectAccess(task.project_id, userId, 'VIEWER');
      if (!hasAccess) {
        return null;
      }

      return await this.enrichTaskWithRelations(task);

    } catch (error) {
      logger.error('TaskService - getTask error:', error);
      throw error;
    }
  }

  static async getTaskById(taskId: string): Promise<any> {
    try {
      const result = await db.query(
        `SELECT * FROM tasks WHERE id = $1`,
        [taskId]
      );
      return result.rows[0];
    } catch (error) {
      logger.error('TaskService - getTaskById error:', error);
      throw error;
    }
  }

  static async getProjectTasks(projectId: string, userId: string): Promise<any[]> {
    try {
      // Verify user has project access
      const hasAccess = await ProjectService.hasProjectAccess(projectId, userId, 'VIEWER');
      if (!hasAccess) {
        throw new ForbiddenError('Access to project denied');
      }

      const result = await db.query(
        `SELECT * FROM tasks WHERE project_id = $1 ORDER BY 
          CASE status 
            WHEN 'TODO' THEN 1
            WHEN 'IN_PROGRESS' THEN 2  
            WHEN 'DONE' THEN 3
          END, created_at DESC`,
        [projectId]
      );

      // Enrich tasks with relations
      const enrichedTasks = [];
      for (const task of result.rows) {
        enrichedTasks.push(await this.enrichTaskWithRelations(task));
      }

      return enrichedTasks;

    } catch (error) {
      logger.error('TaskService - getProjectTasks error:', error);
      throw error;
    }
  }

  static async canUpdateTask(taskId: string, userId: string): Promise<boolean> {
    try {
      const task = await this.getTaskById(taskId);
      if (!task) return false;

      const userRole = await ProjectService.getProjectMemberRole(task.project_id, userId);
      
      // PROJECT_LEAD can update any task
      if (userRole === 'PROJECT_LEAD') return true;

      // CONTRIBUTOR can update tasks assigned to them or unassigned tasks
      if (userRole === 'CONTRIBUTOR') {
        const isAssigned = await this.isTaskAssignedToUser(taskId, userId);
        return isAssigned || !(await this.hasAnyAssignments(taskId));
      }

      // VIEWER cannot update any tasks
      return false;

    } catch (error) {
      logger.error('TaskService - canUpdateTask error:', error);
      return false;
    }
  }

  private static async isTaskAssignedToUser(taskId: string, userId: string): Promise<boolean> {
    try {
      const result = await db.query(
        `SELECT 1 FROM task_assignments WHERE task_id = $1 AND user_id = $2`,
        [taskId, userId]
      );
      return result.rows.length > 0;
    } catch (error) {
      logger.error('TaskService - isTaskAssignedToUser error:', error);
      return false;
    }
  }

  private static async hasAnyAssignments(taskId: string): Promise<boolean> {
    try {
      const result = await db.query(
        `SELECT 1 FROM task_assignments WHERE task_id = $1`,
        [taskId]
      );
      return result.rows.length > 0;
    } catch (error) {
      logger.error('TaskService - hasAnyAssignments error:', error);
      return false;
    }
  }

  private static async enrichTaskWithRelations(task: any): Promise<any> {
    try {
      // Get assigned users
      const assignedUsersResult = await db.query(`
        SELECT u.id, u.email, u.global_status 
        FROM task_assignments ta 
        JOIN users u ON ta.user_id = u.id 
        WHERE ta.task_id = $1
      `, [task.id]);

      // Get project info
      const projectResult = await db.query(
        `SELECT id, name, workspace_id FROM projects WHERE id = $1`,
        [task.project_id]
      );

      // Get creator info
      const creatorResult = await db.query(
        `SELECT id, email FROM users WHERE id = $1`,
        [task.created_by]
      );

      return {
        ...task,
        assignedTo: assignedUsersResult.rows.map((row: any) => ({
          id: row.id,
          email: row.email,
          globalStatus: row.global_status
        })),
        project: projectResult.rows[0] ? {
          id: projectResult.rows[0].id,
          name: projectResult.rows[0].name,
          workspaceId: projectResult.rows[0].workspace_id
        } : null,
        createdBy: creatorResult.rows[0] ? {
          id: creatorResult.rows[0].id,
          email: creatorResult.rows[0].email
        } : null
      };
    } catch (error) {
      logger.error('TaskService - enrichTaskWithRelations error:', error);
      return task; // Return basic task if enrichment fails
    }
  }

  // Get tasks assigned to a specific user
  static async getUserAssignedTasks(userId: string, status?: string): Promise<any[]> {
    try {
      let query = `
        SELECT t.*, p.name as project_name, w.name as workspace_name
        FROM tasks t
        JOIN task_assignments ta ON t.id = ta.task_id
        JOIN projects p ON t.project_id = p.id
        JOIN workspaces w ON p.workspace_id = w.id
        WHERE ta.user_id = $1
      `;
      const params: any[] = [userId];

      if (status) {
        query += ` AND t.status = $2`;
        params.push(status);
      }

      query += ` ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC`;

      const result = await db.query(query, params);
      
      const enrichedTasks = [];
      for (const task of result.rows) {
        enrichedTasks.push(await this.enrichTaskWithRelations(task));
      }

      return enrichedTasks;
    } catch (error) {
      logger.error('TaskService - getUserAssignedTasks error:', error);
      throw error;
    }
  }
}