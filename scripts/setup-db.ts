// scripts/setup-db.ts
import { db } from '../src/database/client.js';
import { readFileSync } from 'fs';
import { join } from 'path';

async function setupDatabase() {
  try {
    console.log('🚀 Setting up database...');
    
    // Read and execute the SQL file
    const sqlPath = join(process.cwd(), 'scripts', 'init-db.sql');
    const sql = readFileSync(sqlPath, 'utf8');
    
    await db.connect();
    
    // Split SQL by statements and execute each
    const statements = sql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);
    
    for (const statement of statements) {
      await db.query(statement);
    }
    
    console.log('✅ Database setup completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    process.exit(1);
  }
}

setupDatabase();