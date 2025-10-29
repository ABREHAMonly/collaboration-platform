// src/rest/docs.ts
import { Router } from 'express';

const router = Router();

router.get('/docs', (req, res) => {
  res.json({
    name: 'Collaboration Platform API',
    version: '1.0.0',
    description: 'A full-stack collaboration platform with Trello-like features',
    endpoints: {
      graphql: {
        url: '/graphql',
        description: 'Main GraphQL endpoint for all queries and mutations'
      },
      rest: {
        auth: {
          login: 'POST /api/auth/login',
          register: 'POST /api/auth/register (GraphQL)',
          logout: 'POST /api/auth/logout',
          refreshToken: 'POST /api/auth/refresh-token',
          revokeSessions: 'POST /api/auth/revoke-all-sessions'
        },
        health: {
          overall: 'GET /api/health',
          database: 'GET /api/health/db'
        }
      }
    },
    authentication: {
      type: 'JWT',
      flow: 'Access token in Authorization header, Refresh token as HTTP-only cookie'
    },
    examples: {
      graphql: {
        query: `query {
          myWorkspaces {
            id
            name
            members {
              user {
                email
              }
              role
            }
          }
        }`,
        mutation: `mutation {
          createTask(input: {
            title: "New Task",
            description: "Task description",
            projectId: "project-uuid"
          }) {
            id
            title
            status
          }
        }`
      }
    }
  });
});

export default router;