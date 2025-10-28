// src/database/client.ts
import { Pool } from 'pg';
import { env } from '../config/env.js';

class DatabaseClient {
  private pool: Pool;
  private static instance: DatabaseClient;

  private constructor() {
    this.pool = new Pool({
      connectionString: env.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
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
    });

    this.pool.on('error', (err: Error) => {
      console.error('❌ PostgreSQL client error:', err);
    });
  }

  public async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      console.log('✅ PostgreSQL database connected successfully');
      client.release();
    } catch (error) {
      console.error('❌ Database connection failed:', error);
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
      console.log(`📊 Executed query in ${duration}ms:`, { text, params });
      return result;
    } catch (error) {
      console.error('❌ Query failed:', { text, params, error });
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
}

export const db = DatabaseClient.getInstance();