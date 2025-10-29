// tests/setup.ts - CREATE THIS FILE
import { beforeAll, afterAll, beforeEach } from 'bun:test';
import { db } from '../src/database/client.js';

// Global test setup
beforeAll(async () => {
  console.log('🚀 Setting up test environment...');
  
  try {
    await db.connect();
    
    // Setup test database schema if needed
    await db.query(`
      CREATE TABLE IF NOT EXISTS test_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        global_status VARCHAR(50) DEFAULT 'ACTIVE'
      )
    `);
    
    console.log('✅ Test database connected and ready');
  } catch (error) {
    console.error('❌ Test database connection failed:', error);
    throw error;
  }
});

afterAll(async () => {
  console.log('🧹 Cleaning up test environment...');
  
  try {
    // Clean up test tables
    await db.query('DROP TABLE IF EXISTS test_users');
    
    // Close database connection
    await db.disconnect();
    console.log('✅ Test database cleaned up');
  } catch (error) {
    console.error('❌ Test cleanup failed:', error);
  }
});

beforeEach(async () => {
  // Clean up test data before each test
  try {
    await db.query('DELETE FROM audit_logs');
    await db.query('DELETE FROM task_assignments');
    await db.query('DELETE FROM tasks');
    await db.query('DELETE FROM project_members');
    await db.query('DELETE FROM projects');
    await db.query('DELETE FROM workspace_members');
    await db.query('DELETE FROM workspaces');
    await db.query('DELETE FROM user_devices');
    await db.query('DELETE FROM users WHERE email LIKE $1', ['test%@example.com']);
  } catch (error) {
    // Tables might not exist yet, that's okay
    console.warn('⚠️ Cleanup failed (tables might not exist):', error);
  }
});