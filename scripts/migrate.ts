// scripts/migrate.ts
import { db } from '../src/database/client.js';
import { readFileSync } from 'fs';
import { join } from 'path';

async function runMigrations() {
  try {
    console.log('🚀 Running database migrations...');

    // Create migrations table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get already executed migrations
    const executedMigrations = await db.query('SELECT name FROM migrations');
    const executedNames = new Set(executedMigrations.rows.map(row => row.name));

    // Define migrations in order
    const migrations = [
      {
        name: '001_add_ai_features.sql',
        sql: `
          -- Add AI-related fields to tasks table
          ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ai_complexity VARCHAR(50);
          ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ai_summary TEXT;
          
          -- Add index for better task searching
          CREATE INDEX IF NOT EXISTS idx_tasks_ai_complexity ON tasks(ai_complexity);
          CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
        `
      },
      {
        name: '002_enhance_audit_logs.sql', 
        sql: `
          -- Add additional fields to audit_logs for better tracking
          ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
          ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS endpoint VARCHAR(500);
          
          -- Add index for faster audit queries
          CREATE INDEX IF NOT EXISTS idx_audit_logs_action_timestamp ON audit_logs(action, timestamp);
          CREATE INDEX IF NOT EXISTS idx_audit_logs_endpoint ON audit_logs(endpoint);
        `
      },
      {
        name: '003_optimize_performance.sql',
        sql: `
          -- Add composite indexes for common query patterns
          CREATE INDEX IF NOT EXISTS idx_workspace_members_role ON workspace_members(workspace_id, role);
          CREATE INDEX IF NOT EXISTS idx_project_members_role ON project_members(project_id, role);
          CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
          
          -- Add partial indexes for active records
          CREATE INDEX IF NOT EXISTS idx_users_active ON users(global_status) WHERE global_status = 'ACTIVE';
          CREATE INDEX IF NOT EXISTS idx_user_devices_active ON user_devices(is_revoked) WHERE is_revoked = false;
        `
      }
    ];

    let executedCount = 0;

    for (const migration of migrations) {
      if (!executedNames.has(migration.name)) {
        console.log(`📋 Executing migration: ${migration.name}`);
        
        try {
          await db.query(migration.sql);
          await db.query('INSERT INTO migrations (name) VALUES ($1)', [migration.name]);
          executedCount++;
          console.log(`✅ Successfully executed: ${migration.name}`);
        } catch (error) {
          console.error(`❌ Failed to execute migration ${migration.name}:`, error);
          throw error;
        }
      } else {
        console.log(`⏭️  Skipping already executed migration: ${migration.name}`);
      }
    }

    console.log(`🎉 Migration completed! Executed ${executedCount} new migration(s).`);
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();