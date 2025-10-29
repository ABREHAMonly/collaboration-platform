// src/graphql/subscription.ts
// src/graphql/subscription.ts - Fixed JWT token type issues
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { GraphQLSchema } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from './schema.js';
import { resolvers } from './resolvers.js';
import { verifyAccessToken } from '../utils/authUtils.js';
import { db } from '../database/client.js';
import { logger } from '../services/logger.js';

// Create schema for subscriptions
const schema: GraphQLSchema = makeExecutableSchema({ typeDefs, resolvers });

interface WebSocketUser {
  userId: string;
  email: string;
}

// Extended JWT payload that includes standard fields
interface JwtPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

export function createWebSocketServer(httpServer: any, graphqlSchema?: GraphQLSchema) {
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql',
  });

  // Use provided schema or create default one
  const subscriptionSchema = graphqlSchema || schema;

  const serverCleanup = useServer(
    {
      schema: subscriptionSchema,
      context: async (ctx) => {
        try {
          const token = (ctx.connectionParams?.authorization as string) || 
                       (ctx.connectionParams?.Authorization as string);
          
          if (token) {
            const cleanToken = token.replace('Bearer ', '');
            const decoded = verifyAccessToken(cleanToken) as JwtPayload;
            
            const userResult = await db.query(
              `SELECT id, email, global_status FROM users WHERE id = $1`,
              [decoded.userId]
            );

            if (userResult.rows.length > 0 && userResult.rows[0].global_status !== 'BANNED') {
              const user: WebSocketUser = {
                userId: userResult.rows[0].id,
                email: userResult.rows[0].email
              };
              
              return {
                user,
                db,
                logger
              };
            }
          }
        } catch (error) {
          logger.warn('WebSocket authentication failed', { 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }

        return { user: null, db, logger };
      },

      onConnect: (ctx) => {
        const userInfo = ctx.connectionParams?.authorization ? 'authenticated' : 'anonymous';
        logger.info('🔌 WebSocket connected', { user: userInfo });
      },

      onDisconnect: (ctx, code, reason) => {
        logger.info('🔌 WebSocket disconnected', { 
          code, 
          reason: reason?.toString() || 'Unknown reason' 
        });
      },

      onSubscribe: (ctx, msg) => {
        const operationName = (msg.payload as any).operationName || 'unknown';
        const user = (ctx.extra as any).user?.userId || 'anonymous';
        
        logger.debug('📡 GraphQL subscription started', { 
          operation: operationName,
          user
        });
      },

      onError: (ctx, msg, errors) => {
        const user = (ctx.extra as any).user?.userId || 'anonymous';
        logger.error('❌ WebSocket error', { 
          errors: errors.map(e => e.message),
          user
        });
      }
    }, 
    wsServer
  );

  logger.info('✅ WebSocket server initialized for GraphQL subscriptions');
  return serverCleanup;
}