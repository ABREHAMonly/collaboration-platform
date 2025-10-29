// tests/setup.ts - CREATE THIS FILE
import { beforeAll, afterAll, beforeEach } from 'bun:test';
import { db } from '../src/database/client.js';

// Global test setup
beforeAll(async () => {
  console.log('🚀 Setting up test environment...');
  
  try {
    await db.connect();
    console.log('✅ Test database connected');
  } catch (error) {
    console.error('❌ Test database connection failed:', error);
    throw error;
  }
});

afterAll(async () => {
  console.log('🧹 Cleaning up test environment...');
});

beforeEach(async () => {
  // Clean up test data before each test
  try {
    await db.query('DELETE FROM user_devices');
    await db.query('DELETE FROM workspace_members');
    await db.query('DELETE FROM workspaces');
    await db.query('DELETE FROM users WHERE email LIKE $1', ['test%@example.com']);
  } catch (error) {
    console.warn('⚠️ Cleanup failed, continuing...', error);
  }
});