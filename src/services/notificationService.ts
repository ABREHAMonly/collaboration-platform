// src/services/notificationService.ts - Fixed for Apollo Server 4
// src/services/notificationService.ts - Fixed missing getUnreadCount method
import { db } from '../database/client.js';
import { logger } from './logger.js';

export class NotificationService {
  static async createTaskAssignmentNotification(
    userId: string, 
    taskId: string, 
    taskTitle: string,
    client?: any
  ): Promise<void> {
    try {
      const query = `
        INSERT INTO notifications (title, body, recipient_id, related_entity_id, entity_type)
        VALUES ($1, $2, $3, $4, $5)
      `;
      
      const values = [
        'New Task Assignment',
        `You have been assigned to task: "${taskTitle}"`,
        userId,
        taskId,
        'TASK'
      ];

      if (client) {
        await client.query(query, values);
      } else {
        await db.query(query, values);
      }

      logger.debug('Task assignment notification created', { userId, taskId });

    } catch (error) {
      logger.error('NotificationService - createTaskAssignmentNotification error:', error);
      // Don't throw error - notification failure shouldn't break the main operation
    }
  }

  static async getUserNotifications(userId: string, status?: string): Promise<any[]> {
    try {
      let query = `
        SELECT n.*, 
               CASE 
                 WHEN n.entity_type = 'TASK' THEN (SELECT title FROM tasks WHERE id = n.related_entity_id)
                 WHEN n.entity_type = 'WORKSPACE' THEN (SELECT name FROM workspaces WHERE id = n.related_entity_id)
                 ELSE NULL
               END as entity_name
        FROM notifications n 
        WHERE n.recipient_id = $1
      `;
      const params: any[] = [userId];

      if (status) {
        query += ` AND n.status = $2`;
        params.push(status);
      }

      query += ` ORDER BY n.created_at DESC LIMIT 50`;

      const result = await db.query(query, params);
      return result.rows.map(row => ({
        ...row,
        entityName: row.entity_name
      }));

    } catch (error) {
      logger.error('NotificationService - getUserNotifications error:', error);
      throw error;
    }
  }

  static async markAsRead(notificationId: string, userId: string): Promise<any> {
    try {
      const result = await db.query(
        `UPDATE notifications 
         SET status = 'SEEN', read_at = CURRENT_TIMESTAMP 
         WHERE id = $1 AND recipient_id = $2 
         RETURNING *`,
        [notificationId, userId]
      );

      if (result.rowCount === 0) {
        throw new Error('Notification not found or access denied');
      }

      logger.debug('Notification marked as read', { notificationId, userId });

      return result.rows[0];

    } catch (error) {
      logger.error('NotificationService - markAsRead error:', error);
      throw error;
    }
  }

  static async markAllAsRead(userId: string): Promise<boolean> {
    try {
      const result = await db.query(
        `UPDATE notifications 
         SET status = 'SEEN', read_at = CURRENT_TIMESTAMP 
         WHERE recipient_id = $1 AND status = 'DELIVERED'`,
        [userId]
      );

      logger.debug('All notifications marked as read', { 
        userId, 
        updatedCount: result.rowCount 
      });

      return true;

    } catch (error) {
      logger.error('NotificationService - markAllAsRead error:', error);
      throw error;
    }
  }

  static async createWorkspaceInviteNotification(
    userId: string,
    workspaceId: string,
    workspaceName: string,
    inviterName: string,
    client?: any
  ): Promise<void> {
    try {
      const query = `
        INSERT INTO notifications (title, body, recipient_id, related_entity_id, entity_type)
        VALUES ($1, $2, $3, $4, $5)
      `;
      
      const values = [
        'Workspace Invitation',
        `You have been invited to join workspace "${workspaceName}" by ${inviterName}`,
        userId,
        workspaceId,
        'WORKSPACE'
      ];

      if (client) {
        await client.query(query, values);
      } else {
        await db.query(query, values);
      }

      logger.debug('Workspace invitation notification created', { userId, workspaceId });

    } catch (error) {
      logger.error('NotificationService - createWorkspaceInviteNotification error:', error);
    }
  }

  static async getUnreadCount(userId: string): Promise<number> {
    try {
      const result = await db.query(
        `SELECT COUNT(*) FROM notifications 
         WHERE recipient_id = $1 AND status = 'DELIVERED'`,
        [userId]
      );

      return parseInt(result.rows[0].count);
    } catch (error) {
      logger.error('NotificationService - getUnreadCount error:', error);
      return 0;
    }
  }

  static async deleteNotification(notificationId: string, userId: string): Promise<boolean> {
    try {
      const result = await db.query(
        `DELETE FROM notifications 
         WHERE id = $1 AND recipient_id = $2`,
        [notificationId, userId]
      );

      if (result.rowCount === 0) {
        throw new Error('Notification not found or access denied');
      }

      logger.debug('Notification deleted', { notificationId, userId });

      return true;

    } catch (error) {
      logger.error('NotificationService - deleteNotification error:', error);
      throw error;
    }
  }

  static async createStatusChangeNotification(
    taskId: string,
    taskTitle: string,
    oldStatus: string,
    newStatus: string,
    changedByUserId: string,
    client?: any
  ): Promise<void> {
    try {
      // Get all users assigned to this task
      const assignedUsersResult = await db.query(
        `SELECT user_id FROM task_assignments WHERE task_id = $1`,
        [taskId]
      );

      for (const assignment of assignedUsersResult.rows) {
        const assignedUserId = assignment.user_id;
        
        // Don't notify the user who made the change
        if (assignedUserId === changedByUserId) continue;

        const query = `
          INSERT INTO notifications (title, body, recipient_id, related_entity_id, entity_type)
          VALUES ($1, $2, $3, $4, $5)
        `;
        
        const values = [
          'Task Status Updated',
          `Task "${taskTitle}" status changed from ${oldStatus} to ${newStatus}`,
          assignedUserId,
          taskId,
          'TASK'
        ];

        if (client) {
          await client.query(query, values);
        } else {
          await db.query(query, values);
        }
      }

      logger.debug('Task status change notifications created', { taskId, oldStatus, newStatus });

    } catch (error) {
      logger.error('NotificationService - createStatusChangeNotification error:', error);
    }
  }
}