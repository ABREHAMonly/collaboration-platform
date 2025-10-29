// src/database/client.ts - Updated with auto-table creation
import { Pool, PoolClient } from 'pg';
import { env } from '../config/env.js';

class DatabaseClient {
  private pool: Pool;
  private static instance: DatabaseClient;
  private isConnected = false;
  private isInitialized = false;
  private connectionAttempts = 0;
  private readonly maxConnectionAttempts = 3;

  private constructor() {
    console.log('🔌 Initializing database connection...');
    
    // Parse database URL for additional configuration
    const databaseUrl = new URL(env.databaseUrl);
    
    this.pool = new Pool({
      connectionString: env.databaseUrl,
      max: env.isProduction ? 20 : 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: env.isProduction ? 10000 : 5000,
      ssl: env.ssl,
      
      // Additional options from URL
      host: databaseUrl.hostname,
      port: parseInt(databaseUrl.port) || 5432,
      database: databaseUrl.pathname.slice(1),
      user: databaseUrl.username,
      password: databaseUrl.password,
    });

    this.setupEventListeners();
  }

  public static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }

  private setupEventListeners(): void {
    this.pool.on('connect', (client: PoolClient) => {
      console.log('✅ PostgreSQL client connected');
      this.isConnected = true;
      this.connectionAttempts = 0;
    });

    this.pool.on('error', (err: Error, client: PoolClient) => {
      console.error('❌ PostgreSQL client error:', err.message);
      this.isConnected = false;
    });

    this.pool.on('remove', () => {
      console.log('🔌 PostgreSQL client removed');
      this.isConnected = false;
    });
  }

  // NEW: Auto-create tables method
  private async initializeTables(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      console.log('🔄 Checking and creating database tables...');
      
      // Enable UUID extension
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

      // Create tables in order (respecting foreign key dependencies)
      const tables = [
        // Users table first (no dependencies)
        `CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          global_status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (global_status IN ('ACTIVE', 'BANNED', 'ADMIN')),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          last_login TIMESTAMP WITH TIME ZONE
        )`,

        // User devices (depends on users)
        `CREATE TABLE IF NOT EXISTS user_devices (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          refresh_token_hash VARCHAR(255) NOT NULL,
          ip_address INET,
          user_agent TEXT,
          device_info JSONB DEFAULT '{}',
          login_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          is_revoked BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )`,

        // Workspaces (depends on users)
        `CREATE TABLE IF NOT EXISTS workspaces (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          name VARCHAR(255) NOT NULL,
          description TEXT,
          created_by UUID NOT NULL REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )`,

        // Workspace members (depends on users and workspaces)
        `CREATE TABLE IF NOT EXISTS workspace_members (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role VARCHAR(50) NOT NULL CHECK (role IN ('OWNER', 'MEMBER', 'VIEWER')),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(workspace_id, user_id)
        )`,

        // Projects (depends on workspaces and users)
        `CREATE TABLE IF NOT EXISTS projects (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          name VARCHAR(255) NOT NULL,
          description TEXT,
          workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          created_by UUID NOT NULL REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )`,

        // Project members (depends on projects and users)
        `CREATE TABLE IF NOT EXISTS project_members (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role VARCHAR(50) NOT NULL CHECK (role IN ('PROJECT_LEAD', 'CONTRIBUTOR', 'VIEWER')),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(project_id, user_id)
        )`,

        // Tasks (depends on projects and users)
        `CREATE TABLE IF NOT EXISTS tasks (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          title VARCHAR(500) NOT NULL,
          description TEXT,
          status VARCHAR(50) DEFAULT 'TODO' CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE')),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          created_by UUID NOT NULL REFERENCES users(id),
          due_date TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )`,

        // Task assignments (depends on tasks and users)
        `CREATE TABLE IF NOT EXISTS task_assignments (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(task_id, user_id)
        )`,

        // Notifications (depends on users)
        `CREATE TABLE IF NOT EXISTS notifications (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          title VARCHAR(255) NOT NULL,
          body TEXT,
          recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status VARCHAR(50) DEFAULT 'DELIVERED' CHECK (status IN ('DELIVERED', 'SEEN')),
          related_entity_id UUID,
          entity_type VARCHAR(50),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          read_at TIMESTAMP WITH TIME ZONE
        )`,

        // Audit logs (depends on users)
        `CREATE TABLE IF NOT EXISTS audit_logs (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          level VARCHAR(50) NOT NULL CHECK (level IN ('info', 'warn', 'error', 'security')),
          user_id UUID REFERENCES users(id),
          ip_address INET,
          action VARCHAR(255) NOT NULL,
          details JSONB DEFAULT '{}',
          message TEXT
        )`
      ];

      // Execute table creation
      for (const tableSql of tables) {
        try {
          await this.pool.query(tableSql);
        } catch (error) {
          // Ignore "already exists" errors, throw others
          if (error instanceof Error && !error.message.includes('already exists')) {
            throw error;
          }
        }
      }

      // Create indexes
      const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
        'CREATE INDEX IF NOT EXISTS idx_users_status ON users(global_status)',
        'CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_user_devices_refresh_token ON user_devices(refresh_token_hash)',
        'CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON workspace_members(workspace_id)',
        'CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id)',
        'CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)',
        'CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)',
        'CREATE INDEX IF NOT EXISTS idx_task_assignments_user_id ON task_assignments(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_task_assignments_task_id ON task_assignments(task_id)',
        'CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id ON notifications(recipient_id)',
        'CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status)',
        'CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)',
        'CREATE INDEX IF NOT EXISTS idx_audit_logs_level ON audit_logs(level)'
      ];

      for (const indexSql of indexes) {
        try {
          await this.pool.query(indexSql);
        } catch (error) {
          // Ignore index creation errors
          console.log('ℹ️ Index might already exist:', indexSql.substring(0, 50));
        }
      }

      // Create update timestamp function and triggers
      const functionSql = `
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
        END;
        $$ language 'plpgsql'
      `;

      await this.pool.query(functionSql);

      // Create triggers for each table that has updated_at
      const triggerTables = ['users', 'workspaces', 'workspace_members', 'projects', 'project_members', 'tasks'];
      
      for (const tableName of triggerTables) {
        const triggerSql = `
          DROP TRIGGER IF EXISTS update_${tableName}_updated_at ON ${tableName};
          CREATE TRIGGER update_${tableName}_updated_at 
          BEFORE UPDATE ON ${tableName} 
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
        `;
        
        try {
          await this.pool.query(triggerSql);
        } catch (error) {
          console.log(`ℹ️ Trigger for ${tableName} might already exist`);
        }
      }

      this.isInitialized = true;
      console.log('✅ Database tables initialized successfully');

    } catch (error) {
      console.error('❌ Database table initialization failed:', error);
      throw error;
    }
  }

  // NEW: Auto-seed admin user
  private async seedInitialData(): Promise<void> {
    try {
      console.log('🌱 Seeding initial admin user...');
      
      const { hashPassword } = await import('../utils/authUtils.js');
      const adminPasswordHash = await hashPassword('admin123');
      
      // Insert admin user
      const result = await this.pool.query(
        `INSERT INTO users (email, password_hash, global_status) 
         VALUES ($1, $2, 'ADMIN') 
         ON CONFLICT (email) DO UPDATE SET global_status = 'ADMIN'
         RETURNING id`,
        ['admin@example.com', adminPasswordHash]
      );

      console.log('✅ Admin user created: admin@example.com / admin123');

      // Create a default workspace for the admin
      const adminId = result.rows[0].id;
      const workspaceResult = await this.pool.query(
        `INSERT INTO workspaces (name, description, created_by) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (name, created_by) DO NOTHING
         RETURNING id`,
        ['My Workspace', 'Default workspace', adminId]
      );

      if (workspaceResult.rows.length > 0) {
        const workspaceId = workspaceResult.rows[0].id;
        
        // Add admin as workspace owner
        await this.pool.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role) 
           VALUES ($1, $2, 'OWNER') 
           ON CONFLICT (workspace_id, user_id) DO NOTHING`,
          [workspaceId, adminId]
        );

        console.log('✅ Default workspace created');
      }

    } catch (error) {
      console.error('❌ Initial data seeding failed:', error);
      // Don't throw error for seeding failures - server can still start
    }
  }

  public async connect(): Promise<void> {
    if (this.isConnected) {
      console.log('ℹ️ Database already connected');
      return;
    }

    // Check if we've exceeded max connection attempts
    if (this.connectionAttempts >= this.maxConnectionAttempts) {
      throw new Error(`Maximum database connection attempts (${this.maxConnectionAttempts}) exceeded`);
    }

    this.connectionAttempts++;

    try {
      console.log(`🔌 Attempting database connection (attempt ${this.connectionAttempts})...`);
      const client = await this.pool.connect();
      
      // Test connection with simple query
      const result = await client.query('SELECT NOW() as current_time, version() as version');
      console.log('✅ PostgreSQL database connected successfully');
      console.log(`📊 Database time: ${result.rows[0].current_time}`);
      
      client.release();
      this.isConnected = true;

      // NEW: Initialize tables and seed data after successful connection
      await this.initializeTables();
      await this.seedInitialData();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Database connection failed (attempt ${this.connectionAttempts}):`, errorMessage);
      this.isConnected = false;
      
      // For production, we might want to retry or exit
      if (env.isProduction && this.connectionAttempts >= this.maxConnectionAttempts) {
        console.error('💥 Fatal: Could not connect to database after multiple attempts');
        process.exit(1);
      }
      
      throw error;
    }
  }

  public getPool(): Pool {
    return this.pool;
  }

  public async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
    const start = Date.now();
    
    // Ensure we're connected
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      // Log slow queries or all queries in development
      if (duration > 1000 || env.isDevelopment) {
        console.log(`📊 Query (${duration}ms):`, { 
          text: text.substring(0, 100) + (text.length > 100 ? '...' : ''), 
          params: params || [],
          rowCount: result.rowCount
        });
      }
      
      return {
        rows: result.rows as T[],
        rowCount: result.rowCount || 0
      };
    } catch (error) {
      console.error('❌ Query failed:', { 
        text: text.substring(0, 200),
        params: params || [],
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Mark as disconnected on certain errors
      if (error instanceof Error && (
        error.message.includes('connection') || 
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('getaddrinfo')
      )) {
        this.isConnected = false;
      }
      
      throw error;
    }
  }

  public async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async healthCheck(): Promise<{ status: boolean; error?: string }> {
    try {
      await this.query('SELECT 1 as health_check');
      return { status: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Database health check failed:', errorMessage);
      return { 
        status: false, 
        error: errorMessage 
      };
    }
  }

  // Graceful shutdown
  public async disconnect(): Promise<void> {
    try {
      await this.pool.end();
      this.isConnected = false;
      console.log('✅ Database connections closed gracefully');
    } catch (error) {
      console.error('❌ Error closing database connections:', error);
    }
  }

  // Get connection status
  public getConnectionStatus(): { isConnected: boolean; attempts: number } {
    return {
      isConnected: this.isConnected,
      attempts: this.connectionAttempts
    };
  }

  // NEW: Check if tables are initialized
  public getInitializationStatus(): { isInitialized: boolean } {
    return {
      isInitialized: this.isInitialized
    };
  }
}

export const db = DatabaseClient.getInstance();