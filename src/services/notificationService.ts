// src/services/notificationService.ts
import { db } from '../database/client.js';

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

    } catch (error) {
      console.error('NotificationService - createTaskAssignmentNotification error:', error);
      // Don't throw error - notification failure shouldn't break the main operation
    }
  }

  static async getUserNotifications(userId: string, status?: string): Promise<any[]> {
    try {
      let query = `SELECT * FROM notifications WHERE recipient_id = $1`;
      const params: any[] = [userId];

      if (status) {
        query += ` AND status = $2`;
        params.push(status);
      }

      query += ` ORDER BY created_at DESC LIMIT 50`;

      const result = await db.query(query, params);
      return result.rows;

    } catch (error) {
      console.error('NotificationService - getUserNotifications error:', error);
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

      return result.rows[0];

    } catch (error) {
      console.error('NotificationService - markAsRead error:', error);
      throw error;
    }
  }

  static async markAllAsRead(userId: string): Promise<boolean> {
    try {
      await db.query(
        `UPDATE notifications 
         SET status = 'SEEN', read_at = CURRENT_TIMESTAMP 
         WHERE recipient_id = $1 AND status = 'DELIVERED'`,
        [userId]
      );

      return true;

    } catch (error) {
      console.error('NotificationService - markAllAsRead error:', error);
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

    } catch (error) {
      console.error('NotificationService - createWorkspaceInviteNotification error:', error);
    }
  }

  static async getUnreadNotificationCount(userId: string): Promise<number> {
    try {
      const result = await db.query(
        `SELECT COUNT(*) FROM notifications 
         WHERE recipient_id = $1 AND status = 'DELIVERED'`,
        [userId]
      );

      return parseInt(result.rows[0].count);
    } catch (error) {
      console.error('NotificationService - getUnreadNotificationCount error:', error);
      return 0;
    }
  }
}