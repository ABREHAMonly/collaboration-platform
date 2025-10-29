// src/rest/health.ts
import { Router } from 'express';
import { db } from '../database/client.js';
import { logger } from '../services/logger.js';

const router = Router();

// Comprehensive health check
router.get('/health', async (req, res) => {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    checks: {
      database: 'unknown',
      memory: 'unknown',
      disk: 'unknown'
    }
  };

  try {
    // Test database connection
    await db.query('SELECT 1');
    healthCheck.checks.database = 'connected';
    
    // Test memory usage
    const used = process.memoryUsage();
    const memoryUsage = used.heapUsed / used.heapTotal;
    healthCheck.checks.memory = memoryUsage < 0.8 ? 'healthy' : 'warning';
    
    res.status(200).json(healthCheck);
    
  } catch (error) {
    healthCheck.status = 'unhealthy';
    healthCheck.checks.database = 'disconnected';
    healthCheck.error = error instanceof Error ? error.message : 'Unknown error';
    
    logger.error('Health check failed', healthCheck);
    res.status(503).json(healthCheck);
  }
});

// Database status endpoint
router.get('/health/db', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as user_count,
        (SELECT COUNT(*) FROM workspaces) as workspace_count,
        (SELECT COUNT(*) FROM tasks) as task_count,
        (SELECT MAX(created_at) FROM audit_logs) as last_audit
    `);
    
    res.json({
      status: 'healthy',
      stats: result.rows[0]
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Database error'
    });
  }
});

export default router;