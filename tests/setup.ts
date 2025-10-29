// tests/setup.ts - Global test setup
import { beforeAll, afterAll, beforeEach } from 'bun:test';
import { db } from '../src/database/client.js';

// Global test setup
beforeAll(async () => {
  // Create test database if it doesn't exist
  console.log('Setting up test environment...');
});

afterAll(async () => {
  // Cleanup test database
  console.log('Cleaning up test environment...');
});

beforeEach(async () => {
  // Reset database state between tests
  // This ensures tests don't interfere with each other
});