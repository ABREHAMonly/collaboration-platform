// src/services/taskService.ts
import { db } from '../database/client.js';
import { logSystem, logActivity } from '../services/logger.js';
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

      await logSystem('info', 'TASK_CREATED', { taskId: result.id, projectId }, userId, ipAddress);
      await logActivity('TASK_CREATED', { taskId: result.id, projectId }, userId, ipAddress);

      // Get project to get workspace ID for subscription
      const project = await ProjectService.getProjectById(projectId);
      if (pubsub && project) {
        pubsub.publish(`TASK_STATUS_UPDATED_${project.workspace_id}`, {
          taskStatusUpdated: {
            ...result,
            status: result.status || 'TODO'
          }
        });
      }

      return result;

    } catch (error) {
      console.error('TaskService - createTask error:', error);
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

            // Create notification for newly assigned users
            if (!await this.wasUserPreviouslyAssigned(taskId, assignedUserId)) {
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

      // Log status change if it occurred
      if (status !== undefined && status !== currentTask.status) {
        await logSystem('info', 'TASK_STATUS_UPDATE', 
          { taskId, oldStatus: currentTask.status, newStatus: status }, 
          userId, 
          ipAddress
        );

        await logActivity('TASK_STATUS_UPDATE', 
          { taskId, oldStatus: currentTask.status, newStatus: status }, 
          userId, 
          ipAddress
        );

        // Publish subscription update
        const project = await ProjectService.getProjectById(result.project_id);
        if (pubsub && project) {
          pubsub.publish(`TASK_STATUS_UPDATED_${project.workspace_id}`, {
            taskStatusUpdated: result
          });
        }
      }

      return result;

    } catch (error) {
      console.error('TaskService - updateTask error:', error);
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

      await logSystem('info', 'TASK_DELETED', { taskId, projectId: task.project_id }, userId, ipAddress);
      await logActivity('TASK_DELETED', { taskId, projectId: task.project_id }, userId, ipAddress);

      return true;

    } catch (error) {
      console.error('TaskService - deleteTask error:', error);
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

      return task;

    } catch (error) {
      console.error('TaskService - getTask error:', error);
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
      console.error('TaskService - getTaskById error:', error);
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
        `SELECT * FROM tasks WHERE project_id = $1 ORDER BY created_at DESC`,
        [projectId]
      );

      return result.rows;

    } catch (error) {
      console.error('TaskService - getProjectTasks error:', error);
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
      console.error('TaskService - canUpdateTask error:', error);
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
      console.error('TaskService - isTaskAssignedToUser error:', error);
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
      console.error('TaskService - hasAnyAssignments error:', error);
      return false;
    }
  }

  private static async wasUserPreviouslyAssigned(taskId: string, userId: string): Promise<boolean> {
    try {
      const result = await db.query(
        `SELECT 1 FROM task_assignments WHERE task_id = $1 AND user_id = $2`,
        [taskId, userId]
      );
      return result.rows.length > 0;
    } catch (error) {
      console.error('TaskService - wasUserPreviouslyAssigned error:', error);
      return false;
    }
  }
}