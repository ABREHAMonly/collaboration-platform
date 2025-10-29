# 🚀 Collaboration Platform - Full Stack Backend API

A complete, production-ready backend API for a Trello-like collaboration platform built with **Bun**, **Express.js**, **PostgreSQL**, and **GraphQL**. Features secure JWT authentication, real-time updates, role-based authorization, and comprehensive logging.

## 🎯 Project Overview

This project implements a full-stack collaboration platform backend with:
- **Secure Authentication**: JWT with access/refresh tokens and device tracking
- **Complex Authorization**: Workspace and project-level role-based permissions
- **Real-time Updates**: GraphQL subscriptions for live task status changes
- **Dual Logging**: File + database audit logging for security compliance
- **AI Integration**: Gemini AI for task summarization and generation
- **Production Ready**: Dockerized deployment with CI/CD

## 🏗️ Architecture

```
Frontend (Any client)
    ↓
Backend API (Bun + Express + GraphQL)
    ↓
PostgreSQL Database (Neon.tech)
    ↓
Real-time Subscriptions (WebSocket)
```

## 🚀 Quick Start

### Prerequisites

- **Bun** (v1.0+): [Installation Guide](https://bun.sh/docs/installation)
- **Docker** & **Docker Compose**: [Docker Desktop](https://docker.com/products/docker-desktop)
- **PostgreSQL**: Local or [Neon.tech](https://neon.tech) (free tier)

### Local Development

1. **Clone and setup**:
```bash
git clone <your-repo-url>
cd collaboration-platform
bun install
```

2. **Environment setup**:
```bash
# Copy environment template
cp .env.development .env

# Update with your database credentials
DATABASE_URL=postgresql://username:password@localhost:5432/collaboration_platform
JWT_SECRET=your-development-jwt-secret-change-in-production
JWT_REFRESH_SECRET=your-development-refresh-secret-change-in-production
```

3. **Start services**:
```bash
# Start PostgreSQL with Docker
docker-compose up -d postgres

# Auto-create tables and start server (NEW: No manual setup needed!)
bun run dev
```

The server will automatically:
- ✅ Connect to PostgreSQL
- ✅ Create all required tables
- ✅ Seed admin user (`admin@example.com` / `admin123`)
- ✅ Start on `http://localhost:4000`

### Production Deployment

#### Option 1: Render.com (Recommended)
1. Fork this repository
2. Connect to [Render.com](https://render.com)
3. Set environment variables in dashboard:
   ```env
   DATABASE_URL=your_neon_connection_string
   JWT_SECRET=generate_secure_random_string
   JWT_REFRESH_SECRET=generate_different_secure_random_string
   NODE_ENV=production
   ```
4. Deploy automatically on git push

#### Option 2: Docker
```bash
docker-compose -f docker-compose.prod.yml up --build -d
```

## 📚 API Documentation

### Base URLs
- **Local**: `http://localhost:4000`
- **Production**: `https://collaboration-platform-9ngo.onrender.com`

### REST Endpoints

#### Authentication
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

Response:
{
  "success": true,
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": { "id", "email", "globalStatus" }
}
```

```http
POST /api/auth/logout
Authorization: Bearer <accessToken>

POST /api/auth/refresh-token
Content-Type: application/json
{
  "refreshToken": "eyJ..."
}
```

#### Health & Info
```http
GET /api/health          # Comprehensive health check
GET /api/health/db       # Database status
GET /api/health/ping     # Simple ping
GET /api/docs           # API documentation
GET /api/test           # Basic connectivity test
```

### GraphQL API

#### Authentication Required Headers
```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

#### Example Queries

**Get User Profile:**
```graphql
query {
  me {
    id
    email
    globalStatus
    createdAt
  }
}
```

**Workspace Operations:**
```graphql
query {
  myWorkspaces {
    id
    name
    members {
      user { email }
      role
    }
    projects {
      name
      taskCount
    }
  }
}

mutation {
  createWorkspace(input: {
    name: "Development Team"
    description: "Our dev team workspace"
  }) {
    id
    name
  }
}
```

**Task Management:**
```graphql
mutation {
  createTask(input: {
    title: "Implement authentication"
    description: "Add JWT auth system"
    projectId: "project-uuid"
    assignedToIds: ["user-uuid"]
  }) {
    id
    title
    status
    assignedTo { email }
  }
}

subscription {
  taskStatusUpdated(workspaceId: "workspace-uuid") {
    id
    title
    status
    updatedAt
  }
}
```

#### Admin Operations
```graphql
# Admin only - view all workspaces
query {
  getAllWorkspaces {
    id
    name
    createdBy { email }
    memberCount
  }
}

# Ban user
mutation {
  userBan(userId: "user-uuid") {
    id
    email
    globalStatus
  }
}
```

## 🔐 Authentication & Authorization

### JWT Token Flow
1. **Login**: Returns `accessToken` (15min) + `refreshToken` (7 days, HTTP-only)
2. **API Calls**: Include `accessToken` in `Authorization` header
3. **Token Refresh**: Use `refreshToken` to get new `accessToken`
4. **Logout**: Server revokes refresh token

### Role Hierarchy

#### Workspace Roles
- **OWNER**: Full workspace control, member management
- **MEMBER**: Create/edit projects and tasks
- **VIEWER**: Read-only access

#### Project Roles
- **PROJECT_LEAD**: Manage members, edit all tasks, delete project
- **CONTRIBUTOR**: Create/edit assigned tasks
- **VIEWER**: Read-only project access

### User Status
- **ACTIVE**: Normal user
- **BANNED**: Cannot login (admin-only)
- **ADMIN**: Full system access

## 🗄️ Database Schema

### Core Tables
- **users**: User accounts and global status
- **workspaces**: Team workspaces with members
- **projects**: Projects within workspaces
- **tasks**: Individual tasks with assignments
- **notifications**: User notifications
- **audit_logs**: Security and activity logs
- **user_devices**: Session and device tracking

### Auto-Creation Feature
Tables are automatically created on server startup - no manual SQL required!

## 🛠️ Development

### Available Scripts
```bash
bun run dev          # Development server with auto-reload
bun run build        # Build for production
bun run start        # Start production server
bun test            # Run test suite
bun run hotfix      # Apply database hotfixes
```

### Project Structure
```
src/
├── config/         # Environment configuration
├── database/       # PostgreSQL client and connection
├── graphql/        # Schema, resolvers, subscriptions
├── middleware/     # Auth, security, rate limiting
├── rest/           # REST endpoints (auth, health, docs)
├── services/       # Business logic (auth, workspace, tasks)
├── utils/          # Auth utilities, helpers
└── server.ts       # Main application entry
```

### Testing
```bash
# Run all tests
bun test

# Run specific test suites
bun test tests/auth.test.ts
bun test tests/workspace.test.ts

# E2E authentication flow
bun test tests/e2e/auth-flow.test.ts
```

## 🔧 Configuration

### Environment Variables
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | - | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | - | JWT signing secret |
| `JWT_REFRESH_SECRET` | ✅ | - | Refresh token secret |
| `NODE_ENV` | ❌ | `development` | Runtime environment |
| `PORT` | ❌ | `4000` | Server port |
| `GEMINI_API_KEY` | ❌ | - | Google AI API key |
| `CORS_ORIGINS` | ❌ | `http://localhost:3000` | Allowed origins |

### Database Configuration
The application automatically:
- Creates all required tables on first run
- Seeds admin user (`admin@example.com` / `admin123`)
- Sets up indexes and constraints
- Creates update timestamp triggers

## 🚢 Deployment

### Render.com (Recommended)
1. Connect GitHub repository to Render
2. Set environment variables in dashboard
3. Automatic deploys on `main` branch push

### Docker Deployment
```bash
# Build and run
docker-compose -f docker-compose.prod.yml up --build -d

# View logs
docker-compose logs -f app
```

### Manual Deployment
```bash
# Build application
bun run build

# Start production server
bun run start
```

## 📊 Monitoring & Logging

### Health Checks
```bash
# Comprehensive health check
curl https://yourapp.com/api/health

# Database status
curl https://yourapp.com/api/health/db-status

# Simple ping
curl https://yourapp.com/api/health/ping
```

### Logging System
- **File Logs**: `logs/audit.log` and `logs/error.log`
- **Database Logs**: `audit_logs` table for compliance
- **Categories**: Authentication, Security, System, Activity

### Example Log Entry
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "security",
  "userId": "user-uuid",
  "ipAddress": "192.168.1.100",
  "action": "USER_BANNED",
  "details": {"targetUserId": "banned-user-uuid"},
  "message": "User banned by admin"
}
```

## 🤖 AI Features (Optional)

Enable AI capabilities by setting `GEMINI_API_KEY`:

```graphql
# Summarize task descriptions
query {
  summarizeTask(input: {
    taskDescription: "Long detailed task description..."
  })
}

# Generate tasks from prompt
mutation {
  generateTasksFromPrompt(input: {
    prompt: "Plan website launch"
    projectId: "project-uuid"
  }) {
    id
    title
    description
  }
}
```

## 🔒 Security Features

- **JWT Authentication** with short-lived access tokens
- **HTTP-only cookies** for refresh tokens
- **Device tracking** with session management
- **Rate limiting** on authentication endpoints
- **CORS protection** with configurable origins
- **Helmet.js** security headers
- **SQL injection protection** with parameterized queries
- **XSS sanitization** middleware

## 🐛 Troubleshooting

### Common Issues

**Database Connection Failed**
```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Test connection manually
bun run scripts/test-connection.ts
```

**Tables Not Created**
- Server automatically creates tables on first run
- Check logs for initialization messages
- Verify database credentials

**Authentication Issues**
- Verify JWT secrets are set
- Check token expiration times
- Confirm user status is not "BANNED"

### Getting Help
1. Check application logs in `logs/` directory
2. Verify environment variables are set
3. Test database connectivity
4. Review health check endpoints

## 📈 Performance

- **Connection Pooling**: 10-20 connections based on environment
- **Query Optimization**: Indexed foreign keys and common queries
- **Caching**: Built-in query result caching
- **Compression**: Gzip compression in production

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

### Development Guidelines
- Write tests for new features
- Update documentation
- Follow existing code style
- Verify all tests pass before submitting

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🎉 Success Stories

This implementation successfully demonstrates:

- ✅ **Production Deployment** on Render.com with Neon PostgreSQL
- ✅ **Auto-Scaling** database and application
- ✅ **Zero-Downtime** deployments
- ✅ **Comprehensive Monitoring** with health checks
- ✅ **Enterprise Security** with audit logging

## 🆘 Support

For issues and questions:
1. Check the troubleshooting section above
2. Review application logs
3. Test health check endpoints
4. Verify environment configuration

---

**Built using Bun, Express, GraphQL, and PostgreSQL**