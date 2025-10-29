// src/graphql/subscription.ts
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from './schema.js';
import { resolvers } from './resolvers.js';
import { verifyAccessToken } from '../utils/authUtils.js';
import { db } from '../database/client.js';
import { logger } from '../services/logger.js';

const schema = makeExecutableSchema({ typeDefs, resolvers });

export function createWebSocketServer(httpServer: any) {
  // Create WebSocket server
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql',
  });

  const serverCleanup = useServer({
    schema,
    
    context: async (ctx) => {
      // Authenticate WebSocket connections
      try {
        const token = ctx.connectionParams?.authorization || 
                     ctx.connectionParams?.Authorization;
        
        if (token) {
          const cleanToken = token.replace('Bearer ', '');
          const decoded = verifyAccessToken(cleanToken);
          
          // Verify user is still active
          const userResult = await db.query(
            `SELECT id, global_status FROM users WHERE id = $1`,
            [decoded.userId]
          );

          if (userResult.rows.length > 0 && userResult.rows[0].global_status !== 'BANNED') {
            return {
              user: decoded,
              db,
              logger
            };
          }
        }
      } catch (error) {
        logger.warn('WebSocket authentication failed', { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
        // Don't throw - allow connection but with null user
      }

      return { user: null, db, logger };
    },

    // Handle connection lifecycle
    onConnect: (ctx) => {
      const userInfo = ctx.connectionParams?.authorization ? 'authenticated' : 'anonymous';
      logger.info('🔌 WebSocket connected', { user: userInfo });
    },

    onDisconnect: (ctx, code, reason) => {
      logger.info('🔌 WebSocket disconnected', { code, reason: reason.toString() });
    },

    onSubscribe: (ctx, msg) => {
      logger.debug('📡 GraphQL subscription started', { 
        operation: msg.payload.operationName,
        user: ctx.extra.user?.userId || 'anonymous'
      });
    },

    onNext: (ctx, msg, args, result) => {
      logger.debug('📡 GraphQL subscription data sent', {
        operation: msg.payload.operationName,
        user: ctx.extra.user?.userId || 'anonymous'
      });
    },

    onError: (ctx, msg, errors) => {
      logger.error('❌ WebSocket subscription error', { 
        errors: errors.map(e => e.message),
        user: ctx.extra.user?.userId || 'anonymous'
      });
    }

  }, wsServer);

  logger.info('✅ WebSocket server initialized for GraphQL subscriptions');
  return serverCleanup;
}

// Graceful shutdown handler for WebSocket server
export function disposeWebSocketServer(cleanup: any) {
  try {
    cleanup.dispose();
    logger.info('✅ WebSocket server closed');
  } catch (error) {
    logger.error('❌ Error closing WebSocket server:', error);
  }
}