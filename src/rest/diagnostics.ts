import { Router } from 'express';
import { db } from '../database/client.js';
import { logger } from '../services/logger.js';

const router = Router();

router.get('/diagnostics', async (req, res) => {
  try {
    const diagnostics = {
  timestamp: new Date().toISOString(),
  environment: process.env.NODE_ENV,
  database: {
    connection: db.getConnectionStatus(),
    initialization: (db as any).getInitializationStatus
      ? (db as any).getInitializationStatus()
      : { isInitialized: 'unknown' }
  } as {
    connection: ReturnType<typeof db.getConnectionStatus>;
    initialization: any;
    tables?: {
      users: number;
      workspaces: number;
      auditLogs: number;
    };
    queryTest?: string;
    error?: string;
  },
  system: {
    nodeVersion: process.version,
    platform: process.platform,
    memory: process.memoryUsage()
  }
};


    // Test database queries
    try {
      const usersCount = await db.query('SELECT COUNT(*) as count FROM users');
      const workspacesCount = await db.query('SELECT COUNT(*) as count FROM workspaces');
      const auditLogsCount = await db.query('SELECT COUNT(*) as count FROM audit_logs');
      
      diagnostics.database = {
        ...diagnostics.database,
        tables: {
          users: parseInt(usersCount.rows[0].count),
          workspaces: parseInt(workspacesCount.rows[0].count),
          auditLogs: parseInt(auditLogsCount.rows[0].count)
        }
      };
    } catch (dbError) {
      diagnostics.database.queryTest = 'failed';
      diagnostics.database.error = dbError instanceof Error ? dbError.message : 'Unknown error';
    }

    res.json({
      success: true,
      diagnostics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/test-queries', async (req, res) => {
  try {
    const testQueries = {
      users: await db.query('SELECT id, email, global_status FROM users LIMIT 5'),
      workspaces: await db.query('SELECT id, name, created_by FROM workspaces LIMIT 5'),
      workspace_members: await db.query('SELECT workspace_id, user_id, role FROM workspace_members LIMIT 5'),
      audit_logs: await db.query('SELECT id, action, level FROM audit_logs LIMIT 5')
    };

    res.json({
      success: true,
      results: Object.entries(testQueries).reduce((acc, [key, value]) => {
        acc[key] = {
          rowCount: value.rowCount,
          rows: value.rows
        };
        return acc;
      }, {} as any)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;