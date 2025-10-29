// scripts/setup-db.ts
import { db } from '../src/database/client.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function setupDatabase() {
  try {
    console.log('🚀 Setting up database...');
    
    // Read and execute the SQL file
    const sqlPath = join(__dirname, 'init-db.sql');
    console.log('📁 Reading SQL file from:', sqlPath);
    
    const sql = readFileSync(sqlPath, 'utf8');
    
    // Connect to database first
    await db.connect();
    
    // Split SQL by statements and execute each (handling triggers properly)
    const statements = sql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📊 Found ${statements.length} SQL statements to execute`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      try {
        console.log(`🔄 Executing statement ${i + 1}/${statements.length}`);
        await db.query(statement);
      } catch (error) {
        // If it's a "already exists" error, just log and continue
        if (error instanceof Error && error.message.includes('already exists')) {
          console.log(`ℹ️  Statement ${i + 1} already applied:`, error.message.split('\n')[0]);
        } else {
          throw error;
        }
      }
    }
    
    console.log('✅ Database setup completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    process.exit(1);
  }
}

// Handle script execution
if (import.meta.url === `file://${process.argv[1]}`) {
  setupDatabase();
}

export { setupDatabase };