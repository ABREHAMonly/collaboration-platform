// src/server.ts - Fixed for Apollo Server 4
import express from 'express';
import { createServer } from 'http';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import mongoSanitize from 'express-mongo-sanitize';
import morgan from 'morgan';
import { env } from './config/env.js';
import { db } from './database/client.js';
import { typeDefs } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers.js';
import authRoutes from './rest/auth.js';
import healthRoutes from './rest/health.js';
import docsRoutes from './rest/docs.js';
import { authenticateToken, optionalAuth } from './middleware/auth.js';
import { securityHeaders, requestLogger } from './middleware/security.js';
import { logger } from './services/logger.js';
import { createWebSocketServer } from './graphql/subscription.js';
import diagnosticsRoutes from './rest/diagnostics.js';

// Custom XSS sanitizer
const xssSanitizer = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.body) {
    const sanitize = (obj: any): any => {
      if (typeof obj === 'string') {
        return obj.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                 .replace(/on\w+=/gi, '');
      }
      if (Array.isArray(obj)) {
        return obj.map(sanitize);
      }
      if (obj && typeof obj === 'object') {
        return Object.fromEntries(
          Object.entries(obj).map(([key, value]) => [key, sanitize(value)])
        );
      }
      return obj;
    };
    
    req.body = sanitize(req.body);
  }
  next();
};

const app = express();
const httpServer = createServer(app);

// FIX 1: Trust proxy for production
app.set('trust proxy', 1);

// Security middleware first
app.use(securityHeaders);
app.use(helmet({
  contentSecurityPolicy: env.isProduction,
  crossOriginEmbedderPolicy: env.isProduction,
}));

// Compression for production
if (env.isProduction) {
  app.use(compression());
}

// CORS configuration
app.use(cors({
  origin: [
    'https://collaboration-platform-frontend.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token']
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProduction ? 100 : 1000,
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: env.isProduction ? 5 : 50,
  message: 'Too many authentication attempts',
  standardHeaders: true,
  legacyHeaders: false,
});

// FIX 3: Add test routes early
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'Server is working successfully!',
    environment: env.nodeEnv,
    timestamp: new Date().toISOString()
  });
});

// Database test endpoint
app.get('/api/db-test', async (req, res) => {
  try {
    const result = await db.query('SELECT NOW() as time, version() as version');
    res.json({
      success: true,
      database: 'Connected',
      time: result.rows[0].time,
      version: result.rows[0].version
    });
  } catch (error) {
    res.json({
      success: false,
      database: 'Connection failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Collaboration Platform API',
    version: '1.0.0',
    environment: env.nodeEnv,
    endpoints: {
      graphql: '/graphql',
      rest: '/api',
      health: '/api/health',
      docs: '/api/docs',
      auth: '/api/auth',
      test: '/api/test',
      dbTest: '/api/db-test'
    }
  });
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/refresh-token', authLimiter);

// Body parsing with security
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Security middleware
app.use(mongoSanitize());
app.use(xssSanitizer);

// Logging
app.use(morgan('combined', { 
  stream: { write: (message) => logger.info(message.trim()) } 
}));
app.use(requestLogger);


// Health checks (no authentication required)
app.use('/api/health', healthRoutes);

app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'Backend is working!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// API Documentation
app.use('/api/docs', docsRoutes);

// REST routes
app.use('/api/auth', authRoutes);

// GraphQL setup - FIXED: Pass typeDefs and resolvers directly
const apolloServer = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: env.isDevelopment,
  plugins: [
    {
      async requestDidStart() {
        return {
          async didResolveOperation(requestContext) {
            const user = (requestContext.contextValue as any)?.user;
            logger.info('GraphQL Request', {
              operationName: requestContext.request.operationName,
              user: user?.userId,
              environment: env.nodeEnv
            });
          },
        };
      }
    }
  ],
});

// Create WebSocket server for subscriptions
const serverCleanup = createWebSocketServer(httpServer);



async function runStartupMigrations() {
  try {
    console.log('🚀 Running startup database optimizations...');
    
    // Critical performance indexes
    const migrationQueries = [
      // 1. Workspace/Project role indexes
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_members_user_role 
       ON workspace_members(user_id, role) 
       WHERE role IN ('OWNER', 'MEMBER')`,

      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_members_user_role 
       ON project_members(user_id, role) 
       WHERE role IN ('PROJECT_LEAD', 'CONTRIBUTOR')`,

      // 2. Task indexes
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_created_by_status 
       ON tasks(created_by, status)`,

      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_due_date_status 
       ON tasks(due_date, status) 
       WHERE due_date IS NOT NULL`,

      // 3. Notification index
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_created 
       ON notifications(recipient_id, created_at DESC) 
       WHERE status = 'DELIVERED'`,

      // 4. Audit log index
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_timestamp_level 
       ON audit_logs(timestamp DESC, level)`,

      // 5. User index
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at 
       ON users(created_at DESC) 
       WHERE global_status = 'ACTIVE'`
    ];

    let successCount = 0;
    
    for (let i = 0; i < migrationQueries.length; i++) {
      try {
        await db.query(migrationQueries[i]);
        successCount++;
        console.log(`✅ Created index ${i + 1}/${migrationQueries.length}`);
      } catch (error) {
        // If index already exists, just continue
        if (error instanceof Error && error.message.includes('already exists')) {
          console.log(`ℹ️  Index ${i + 1} already exists`);
          successCount++;
        } else {
          console.log(`⚠️  Could not create index ${i + 1}:`, error instanceof Error ? error.message : 'Unknown error');
        }
      }
    }

    console.log(`🎉 Startup migrations completed: ${successCount}/${migrationQueries.length} successful`);
    
  } catch (error) {
    console.log('⚠️  Startup migrations encountered issues, but server will continue:', error);
    // Don't throw error - server should start even if migrations fail
  }
}

// Initialize server
async function startServer() {
  try {
    // Connect to database first
    await db.connect();
    logger.info('✅ Database connected successfully');
    // Run migrations automatically
    await runStartupMigrations();

    // Start Apollo Server
    await apolloServer.start();
    logger.info('✅ Apollo Server started');

    // GraphQL endpoint (with optional authentication)
app.use('/graphql', 
  optionalAuth, // Use optionalAuth instead of authenticateToken
  expressMiddleware(apolloServer, {
    context: async ({ req, res }) => {
      return {
        user: req.user, // This will be null for public operations
        req,
        res,
        db,
        logger,
        env
      };
    }
  })
);
    app.use('/api/diagnostics', diagnosticsRoutes);

    // Global error handler
    app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Unhandled error', {
        error: error.message,
        stack: env.isDevelopment ? error.stack : undefined,
        url: req.url,
        method: req.method,
        ip: req.ip,
        environment: env.nodeEnv
      });

      res.status(500).json({
        success: false,
        message: env.isProduction 
          ? 'Internal server error' 
          : error.message
      });
    });

    // FIX 2: 404 handler at the VERY END - AFTER all other routes
    app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.path,
        method: req.method,
        availableEndpoints: {
          root: 'GET /',
          health: 'GET /api/health',
          test: 'GET /api/test',
          dbTest: 'GET /api/db-test',
          docs: 'GET /api/docs',
          auth: 'POST /api/auth/*',
          graphql: 'POST /graphql'
        }
      });
    });




    // Start server
    const PORT = env.port;
    httpServer.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📊 Environment: ${env.nodeEnv}`);
      logger.info(`🔗 GraphQL: http://localhost:${PORT}/graphql`);
      logger.info(`🔗 REST API: http://localhost:${PORT}/api`);
      logger.info(`🔗 Subscriptions: ws://localhost:${PORT}/graphql`);
      logger.info(`📚 Documentation: http://localhost:${PORT}/api/docs`);
      logger.info(`❤️ Health: http://localhost:${PORT}/api/health`);
    });

  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`📡 ${signal} received, starting graceful shutdown`);
  
  try {
    await serverCleanup.dispose();
    await apolloServer.stop();
    await db.disconnect();
    
    httpServer.close(() => {
      logger.info('✅ HTTP server closed');
      process.exit(0);
    });
    
    // Force close after 10 seconds
    setTimeout(() => {
      logger.error('❌ Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  } catch (error) {
    logger.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the server
startServer();

export default app;