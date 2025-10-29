// src/database/client.ts - Fixed for production
import { Pool, PoolClient } from 'pg';
import { env } from '../config/env.js';

class DatabaseClient {
  private pool: Pool;
  private static instance: DatabaseClient;
  private isConnected = false;
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
      this.connectionAttempts = 0; // Reset on successful connection
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
}

export const db = DatabaseClient.getInstance();