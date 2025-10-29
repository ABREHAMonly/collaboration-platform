// src/services/logger.ts
import winston from 'winston';
import { db } from '../database/client.js';
import { env } from '../config/env.js';

// Ensure logs directory exists
import { existsSync, mkdirSync } from 'fs';
if (!existsSync('logs')) {
  mkdirSync('logs', { recursive: true });
}

// Define log levels following your existing severity patterns
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  security: 3,
  debug: 4
};

// Create file transport following your logging patterns
const fileTransport = new winston.transports.File({
  filename: 'logs/audit.log',
  level: 'security',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  )
});

// Create error log file
const errorFileTransport = new winston.transports.File({
  filename: 'logs/error.log',
  level: 'error',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  )
});

// Create console transport for development
const consoleTransport = new winston.transports.Console({
  level: env.nodeEnv === 'development' ? 'debug' : 'warn',
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level}]: ${message} ${
        Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
      }`;
    })
  )
});

// Main logger instance
export const logger = winston.createLogger({
  levels,
  level: env.nodeEnv === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { 
    service: 'collaboration-platform',
    environment: env.nodeEnv
  },
  transports: [
    fileTransport,
    errorFileTransport,
    ...(env.nodeEnv === 'development' ? [consoleTransport] : [])
  ]
});

// Database logging service following your dual logging requirement
export class AuditLogger {
  static async logToDatabase(entry: {
    level: 'info' | 'warn' | 'error' | 'security';
    userId?: string;
    ipAddress?: string;
    action: string;
    details: any;
    message?: string;
  }): Promise<void> {
    try {
      // Don't log to database in test environment
      if (env.nodeEnv === 'test') return;

      const query = `
        INSERT INTO audit_logs (level, user_id, ip_address, action, details, message, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      `;
      
      await db.query(query, [
        entry.level,
        entry.userId,
        entry.ipAddress,
        entry.action,
        typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details),
        entry.message
      ]);
    } catch (error) {
      // Fallback to file logging if database fails
      logger.error('Failed to write audit log to database', {
        error: error instanceof Error ? error.message : 'Unknown error',
        originalEntry: entry
      });
    }
  }

  // Authentication logs following your auth patterns
  static async authLog(
    level: 'info' | 'warn' | 'error' | 'security',
    action: string,
    details: any,
    userId?: string,
    ipAddress?: string
  ): Promise<void> {
    const message = this.getAuthMessage(action, details);
    
    // File logging
    logger.log(level, message, { userId, ipAddress, action, details });
    
    // Database logging
    await this.logToDatabase({
      level,
      userId,
      ipAddress,
      action,
      details,
      message
    });
  }

  // System logs
  static async systemLog(
    level: 'info' | 'warn' | 'error',
    action: string,
    details: any,
    userId?: string,
    ipAddress?: string
  ): Promise<void> {
    const message = this.getSystemMessage(action, details);
    
    logger.log(level, message, { userId, ipAddress, action, details });
    await this.logToDatabase({ 
      level, 
      userId, 
      ipAddress, 
      action, 
      details, 
      message 
    });
  }

  // Activity tracker logs
  static async activityLog(
    action: string,
    details: any,
    userId: string,
    ipAddress?: string
  ): Promise<void> {
    const message = this.getActivityMessage(action, details);
    
    logger.info(message, { userId, ipAddress, action, details });
    await this.logToDatabase({
      level: 'info',
      userId,
      ipAddress,
      action,
      details,
      message
    });
  }

  // Helper methods for consistent messaging
  private static getAuthMessage(action: string, details: any): string {
    const messages: Record<string, string> = {
      'LOGIN_SUCCESS': `User login successful`,
      'LOGIN_FAILURE': `Failed login attempt`,
      'LOGOUT': `User logged out`,
      'REFRESH_TOKEN': `Token refreshed`,
      'USER_BANNED': `User banned by admin`,
      'USER_UNBANNED': `User unbanned by admin`,
      'PASSWORD_RESET_REQUEST': `Password reset requested`,
      'PASSWORD_RESET_COMPLETE': `Password reset completed`,
      'ADMIN_RESET_PASSWORD': `Admin reset user password`
    };

    return messages[action] || `Auth action: ${action}`;
  }

  private static getSystemMessage(action: string, details: any): string {
    const messages: Record<string, string> = {
      'TASK_STATUS_UPDATE': `Task status updated`,
      'WORKSPACE_CREATED': `Workspace created`,
      'WORKSPACE_DELETED': `Workspace deleted`,
      'PROJECT_CREATED': `Project created`,
      'PROJECT_DELETED': `Project deleted`,
      'MEMBER_ADDED': `Member added to workspace/project`,
      'MEMBER_REMOVED': `Member removed from workspace/project`,
      'ROLE_UPDATED': `Member role updated`
    };

    return messages[action] || `System action: ${action}`;
  }

  private static getActivityMessage(action: string, details: any): string {
    const messages: Record<string, string> = {
      'TASK_CREATED': `Task created`,
      'TASK_UPDATED': `Task updated`,
      'TASK_DELETED': `Task deleted`,
      'TASK_ASSIGNED': `Task assigned to user`,
      'NOTIFICATION_SENT': `Notification sent to user`
    };

    return messages[action] || `Activity: ${action}`;
  }
}

// Export convenience methods following your existing patterns
export const logAuth = AuditLogger.authLog.bind(AuditLogger);
export const logSystem = AuditLogger.systemLog.bind(AuditLogger);
export const logActivity = AuditLogger.activityLog.bind(AuditLogger);