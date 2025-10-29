// scripts/migrate-prod.ts
import { db } from '../src/database/client.js';

async function runProductionMigrations() {
  try {
    console.log('🚀 Running production database migrations...');

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

    // Production-specific migrations
    const migrations = [
      {
        name: '004_production_optimizations.sql',
        sql: `
          -- Add performance indexes for production
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_created_at_status ON notifications(created_at, status);
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_action_timestamp ON audit_logs(action, timestamp DESC);
          
          -- Add constraints for data integrity
          ALTER TABLE tasks ADD CONSTRAINT tasks_status_check 
            CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE'));
            
          ALTER TABLE users ADD CONSTRAINT users_status_check 
            CHECK (global_status IN ('ACTIVE', 'BANNED', 'ADMIN'));
        `
      },
      {
        name: '005_enhance_security.sql',
        sql: `
          -- Add security-related fields
          ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS account_locked_until TIMESTAMP WITH TIME ZONE;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS last_password_change TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
          
          -- Add indexes for security queries
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_failed_logins ON users(failed_login_attempts) WHERE failed_login_attempts > 0;
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_devices_revoked ON user_devices(is_revoked) WHERE is_revoked = true;
        `
      }
    ];

    let executedCount = 0;

    for (const migration of migrations) {
      if (!executedNames.has(migration.name)) {
        console.log(`📋 Executing production migration: ${migration.name}`);
        
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

    console.log(`🎉 Production migrations completed! Executed ${executedCount} new migration(s).`);
    process.exit(0);

  } catch (error) {
    console.error('❌ Production migration failed:', error);
    process.exit(1);
  }
}

runProductionMigrations();