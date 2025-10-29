import { Pool } from 'pg';
import { env } from '../config/env.js';

class DatabaseClient {
  private pool: Pool;
  private static instance: DatabaseClient;
  private isConnected = false;

  private constructor() {
    console.log('🔌 Initializing database connection...');
    
    // Better connection configuration for cloud
    this.pool = new Pool({
      connectionString: env.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000, // Increased for cloud
      ssl: env.isProduction ? { rejectUnauthorized: false } : false,
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
    this.pool.on('connect', () => {
      console.log('✅ PostgreSQL client connected');
      this.isConnected = true;
    });

    this.pool.on('error', (err: Error) => {
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
      return;
    }

    try {
      console.log('🔌 Attempting database connection...');
      const client = await this.pool.connect();
      
      // Test connection with simple query
      await client.query('SELECT NOW()');
      console.log('✅ PostgreSQL database connected successfully');
      
      client.release();
      this.isConnected = true;
    } catch (error) {
      console.error('❌ Database connection failed:', error instanceof Error ? error.message : 'Unknown error');
      this.isConnected = false;
      throw error;
    }
  }

  public getPool(): Pool {
    return this.pool;
  }

  public async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      // Only log slow queries in production
      if (duration > 1000 || env.isDevelopment) {
        console.log(`📊 Query (${duration}ms):`, { 
          text: text.substring(0, 100) + (text.length > 100 ? '...' : ''), 
          params: params || [] 
        });
      }
      
      return result;
    } catch (error) {
      console.error('❌ Query failed:', { 
        text: text.substring(0, 200),
        params: params || [],
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      this.isConnected = false;
      throw error;
    }
  }

  public async transaction<T>(callback: (client: any) => Promise<T>): Promise<T> {
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

  public async healthCheck(): Promise<boolean> {
    try {
      await this.query('SELECT 1 as health_check');
      return true;
    } catch (error) {
      console.error('❌ Database health check failed:', error);
      return false;
    }
  }

  // Graceful shutdown
  public async disconnect(): Promise<void> {
    try {
      await this.pool.end();
      this.isConnected = false;
      console.log('✅ Database connections closed');
    } catch (error) {
      console.error('❌ Error closing database connections:', error);
    }
  }
}

export const db = DatabaseClient.getInstance();