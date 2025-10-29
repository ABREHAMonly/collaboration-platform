// src/server.ts - Final version with all middleware
import express from 'express';
import { createServer } from 'http';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { makeExecutableSchema } from '@graphql-tools/schema';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import mongoSanitize from 'express-mongo-sanitize';
import xssSanitize from 'express-xss-sanitizer';
import morgan from 'morgan';
import { env } from './config/env.js';
import { db } from './database/client.js';
import { typeDefs } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers.js';
import authRoutes from './rest/auth.js';
import healthRoutes from './rest/health.js';
import docsRoutes from './rest/docs.js';
import { authenticateToken } from './middleware/auth.js';
import { securityHeaders, requestLogger } from './middleware/security.js';
import { logger } from './services/logger.js';
import { createWebSocketServer } from './graphql/subscription.js';

const app = express();
const httpServer = createServer(app);

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
  origin: env.corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
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

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/refresh-token', authLimiter);

// Body parsing with security
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Security middleware
app.use(mongoSanitize());
app.use(xssSanitize());

// Logging
app.use(morgan('combined', { 
  stream: { write: (message) => logger.info(message.trim()) } 
}));
app.use(requestLogger);

// Health checks (no authentication required)
app.use('/api/health', healthRoutes);

// API Documentation
app.use('/api/docs', docsRoutes);

// REST routes
app.use('/api/auth', authRoutes);

// GraphQL setup
const schema = makeExecutableSchema({ typeDefs, resolvers });

const apolloServer = new ApolloServer({
  schema,
  introspection: env.isDevelopment,
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

// GraphQL endpoint (authenticated)
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

// Create WebSocket server for subscriptions
const serverCleanup = createWebSocketServer(httpServer);

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

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`📡 ${signal} received, starting graceful shutdown`);
  
  serverCleanup.dispose();
  await apolloServer.stop();
  
  httpServer.close(() => {
    logger.info('✅ HTTP server closed');
    process.exit(0);
  });
  
  setTimeout(() => {
    logger.error('❌ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;