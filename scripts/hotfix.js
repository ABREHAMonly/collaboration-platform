import { db } from '../src/database/client.ts';

async function applyHotfix() {
  try {
    console.log('🔧 Applying database hotfix...');
    
    await db.connect();
    
    // Add unique constraint for workspaces
    await db.query(`
      ALTER TABLE workspaces 
      ADD CONSTRAINT IF NOT EXISTS workspace_name_created_by_unique 
      UNIQUE (name, created_by)
    `);
    
    console.log('✅ Hotfix applied successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Hotfix failed:', error);
    process.exit(1);
  }
}

applyHotfix();