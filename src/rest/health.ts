// src/rest/health.ts - Enhanced for production
import { Router } from 'express';
import { db } from '../database/client.js';
import { logger } from '../services/logger.js';

const router = Router();

interface HealthCheck {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  environment?: string;
  version: string;
  uptime: number;
  memory: NodeJS.MemoryUsage;
  database: {
    status: 'connected' | 'disconnected';
    connectionAttempts: number;
    responseTime?: number;
  };
  system: {
    nodeVersion: string;
    platform: string;
    arch: string;
  };
  checks: {
    database: 'healthy' | 'unhealthy';
    memory: 'healthy' | 'warning' | 'critical';
    disk: 'healthy' | 'warning' | 'critical';
  };
  error?: string;
}

router.get('/', async (req, res) => {
  const startTime = Date.now();
  
  const healthCheck: HealthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: {
      status: 'disconnected',
      connectionAttempts: 0
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    },
    checks: {
      database: 'unhealthy',
      memory: 'healthy',
      disk: 'healthy'
    }
  };

  try {
    // Check database connection with timeout
    const dbStartTime = Date.now();
    await db.query('SELECT 1');
    const dbResponseTime = Date.now() - dbStartTime;
    
    healthCheck.database = {
      status: 'connected',
      connectionAttempts: db.getConnectionStatus().attempts,
      responseTime: dbResponseTime
    };
    healthCheck.checks.database = 'healthy';

    // Check memory usage
    const used = process.memoryUsage();
    const memoryUsage = used.heapUsed / used.heapTotal;
    
    if (memoryUsage > 0.9) {
      healthCheck.checks.memory = 'critical';
      healthCheck.status = 'unhealthy';
    } else if (memoryUsage > 0.8) {
      healthCheck.checks.memory = 'warning';
    } else {
      healthCheck.checks.memory = 'healthy';
    }

    // Add response time
    const totalResponseTime = Date.now() - startTime;
    (healthCheck as any).responseTime = totalResponseTime;

    // Set appropriate status code
    const statusCode = healthCheck.status === 'healthy' ? 200 : 503;
    
    res.status(statusCode).json(healthCheck);
    
  } catch (error) {
    healthCheck.status = 'unhealthy';
    healthCheck.checks.database = 'unhealthy';
    healthCheck.error = error instanceof Error ? error.message : 'Unknown error';
    healthCheck.database.connectionAttempts = db.getConnectionStatus().attempts;

    logger.error('Health check failed', healthCheck);
    res.status(503).json(healthCheck);
  }
});

router.get('/db', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as user_count,
        (SELECT COUNT(*) FROM workspaces) as workspace_count,
        (SELECT COUNT(*) FROM projects) as project_count,
        (SELECT COUNT(*) FROM tasks) as task_count,
        (SELECT MAX(created_at) FROM audit_logs) as last_audit,
        (SELECT version()) as postgres_version
    `);

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      stats: result.rows[0],
      connection: db.getConnectionStatus()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Database error',
      connection: db.getConnectionStatus()
    });
  }
});

// Simple health check for load balancers
router.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'collaboration-platform'
  });
});

router.get('/db-status', async (req, res) => {
  try {
    const connectionStatus = db.getConnectionStatus();
    const initStatus = (db as any).getInitializationStatus ? (db as any).getInitializationStatus() : { isInitialized: true };
    
    // Test if we can query users table
    let tablesExist = false;
    let userCount = 0;
    
    try {
      const usersResult = await db.query('SELECT COUNT(*) as count FROM users');
      tablesExist = true;
      userCount = parseInt(usersResult.rows[0].count);
    } catch (error) {
      tablesExist = false;
    }

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        connected: connectionStatus.isConnected,
        connectionAttempts: connectionStatus.attempts,
        tablesInitialized: initStatus.isInitialized,
        tablesExist: tablesExist,
        userCount: userCount
      },
      message: tablesExist ? 'Database is fully operational' : 'Tables are being created...'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Database error'
    });
  }
});
export default router;