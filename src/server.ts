// src/server.ts
import express from 'express';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { makeExecutableSchema } from '@graphql-tools/schema';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { db } from './database/client.js';
import { typeDefs } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers.js';
import authRoutes from './rest/auth.js';
import { authenticateToken } from './middleware/auth.js';
import { logger } from './services/logger.js';

const app = express();

// Security middleware following your patterns
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration following your patterns
app.use(cors({
  origin: env.nodeEnv === 'production' 
    ? ['https://yourdomain.com'] 
    : ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate limiting following your patterns
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: 'Too many requests from this IP'
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Too many authentication attempts'
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/refresh-token', authLimiter);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    await db.query('SELECT 1');
    
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: env.nodeEnv,
      database: 'connected'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// REST routes
app.use('/api/auth', authRoutes);

// GraphQL setup
const schema = makeExecutableSchema({ typeDefs, resolvers });

const apolloServer = new ApolloServer({
  schema,
  plugins: [
    // Basic logging plugin
    {
      requestDidStart: async () => ({
        didResolveOperation: async (requestContext) => {
          logger.info('GraphQL Request', {
            operationName: requestContext.request.operationName,
            variables: requestContext.request.variables
          });
        },
        didEncounterErrors: async (requestContext) => {
          logger.error('GraphQL Errors', {
            errors: requestContext.errors,
            operationName: requestContext.request.operationName
          });
        }
      })
    }
  ]
});

await apolloServer.start();

// GraphQL endpoint with authentication
app.use('/graphql', 
  authenticateToken,
  expressMiddleware(apolloServer, {
    context: async ({ req }) => {
      return {
        user: (req as any).user,
        db,
        logger
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

// Global error handler following your patterns
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  res.status(500).json({
    success: false,
    message: env.nodeEnv === 'production' 
      ? 'Internal server error' 
      : error.message
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await apolloServer.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await apolloServer.stop();
  process.exit(0);
});

// Start server
const PORT = env.port;
app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📊 Environment: ${env.nodeEnv}`);
  logger.info(`🔗 GraphQL endpoint: http://localhost:${PORT}/graphql`);
  logger.info(`🔗 REST endpoints: http://localhost:${PORT}/api`);
  logger.info(`❤️ Health check: http://localhost:${PORT}/health`);
});

export default app;