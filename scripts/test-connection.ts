// scripts/test-connection.ts
import { db } from '../src/database/client.js';

async function testConnection() {
  try {
    console.log('🔌 Testing database connection...');
    await db.connect();
    
    console.log('✅ Database connection successful!');
    console.log('📊 Running test query...');
    
    const result = await db.query('SELECT version()');
    console.log('✅ PostgreSQL version:', result.rows[0].version);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    console.log('\n💡 Troubleshooting tips:');
    console.log('1. Make sure PostgreSQL is running: docker-compose up -d postgres');
    console.log('2. Check your DATABASE_URL in .env.development');
    console.log('3. Verify PostgreSQL credentials');
    process.exit(1);
  }
}

testConnection();