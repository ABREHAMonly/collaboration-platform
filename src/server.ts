// src/server.ts - Cloud Optimized
import express from 'express';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { makeExecutableSchema } from '@graphql-tools/schema';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import { env } from './config/env.js';
import { db } from './database/client.js';
import { typeDefs } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers.js';
import authRoutes from './rest/auth.js';
import { authenticateToken } from './middleware/auth.js';
import { logger } from './services/logger.js';

const app = express();

// Compression for production
if (env.isProduction) {
  app.use(compression());
}

// Enhanced security for production
app.use(helmet({
  contentSecurityPolicy: env.isProduction,
  crossOriginEmbedderPolicy: env.isProduction,
}));

// CORS configuration for cloud
app.use(cors({
  origin: env.corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// Enhanced rate limiting for production
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProduction ? 100 : 1000, // Stricter in production
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: env.isProduction ? 5 : 50, // Stricter in production
  message: 'Too many authentication attempts',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/refresh-token', authLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Enhanced health check for cloud
app.get('/health', async (req, res) => {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: env.nodeEnv,
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  };

  try {
    // Test database connection
    await db.query('SELECT 1');
    healthCheck.database = 'connected';
    
    res.status(200).json(healthCheck);
  } catch (error) {
    healthCheck.status = 'unhealthy';
    healthCheck.database = 'disconnected';
    healthCheck.error = error instanceof Error ? error.message : 'Unknown error';
    
    res.status(503).json(healthCheck);
  }
});

// REST routes
app.use('/api/auth', authRoutes);

// GraphQL setup
const schema = makeExecutableSchema({ typeDefs, resolvers });

const apolloServer = new ApolloServer({
  schema,
  introspection: env.isDevelopment, // Enable introspection only in development
  plugins: [
    {
      requestDidStart: async () => ({
        didResolveOperation: async (requestContext) => {
          logger.info('GraphQL Request', {
            operationName: requestContext.request.operationName,
            user: requestContext.contextValue?.user?.userId,
            environment: env.nodeEnv
          });
        },
      })
    }
  ],
});

await apolloServer.start();

// GraphQL endpoint
app.use('/graphql', 
  authenticateToken,
  expressMiddleware(apolloServer, {
    context: async ({ req }) => {
      return {
        user: (req as any).user,
        db,
        logger,
        env
      };
    }
  })
);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Global error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', {
    error: error.message,
    stack: env.isDevelopment ? error.stack : undefined, // Hide stack in production
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

// Start server
const PORT = env.port;
app.listen(PORT, '0.0.0.0', () => { // Listen on all interfaces for Docker
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📊 Environment: ${env.nodeEnv}`);
  logger.info(`🔗 GraphQL: http://localhost:${PORT}/graphql`);
  logger.info(`🔗 REST API: http://localhost:${PORT}/api`);
  logger.info(`❤️ Health: http://localhost:${PORT}/health`);
});

export default app;