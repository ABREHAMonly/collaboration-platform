// src/graphql/subscription.ts
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from './schema.js';
import { resolvers } from './resolvers.js';
import { verifyAccessToken, TokenPayload } from '../utils/authUtils.js';
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
        if (ctx.connectionParams?.authorization) {
          const token = ctx.connectionParams.authorization.replace('Bearer ', '');
          const decoded = verifyAccessToken(token) as TokenPayload;
          
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
        logger.warn('WebSocket authentication failed', { error });
        throw new Error('Authentication failed');
      }

      return { user: null, db, logger };
    },

    // Handle connection lifecycle
    onConnect: (ctx) => {
      logger.info('🔌 WebSocket connected', { 
        user: ctx.connectionParams?.authorization ? 'authenticated' : 'anonymous' 
      });
    },

    onDisconnect: (ctx) => {
      logger.info('🔌 WebSocket disconnected');
    },

    onSubscribe: (ctx, msg) => {
      logger.debug('📡 GraphQL subscription started', { 
        operation: msg.payload.operationName,
        user: ctx.extra.user?.userId 
      });
    },

    onError: (ctx, msg, errors) => {
      logger.error('❌ WebSocket error', { errors, user: ctx.extra.user?.userId });
    }
  }, wsServer);

  logger.info('✅ WebSocket server initialized for GraphQL subscriptions');
  return serverCleanup;
}