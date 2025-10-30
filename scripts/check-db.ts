import { db } from '../src/database/client.js';

async function checkDatabase() {
  try {
    console.log('🔍 Checking database state...');
    
    await db.connect();
    
    // Check tables
    const tables = [
      'users', 'workspaces', 'workspace_members', 
      'projects', 'project_members', 'tasks',
      'audit_logs', 'notifications'
    ];
    
    for (const table of tables) {
      try {
        const result = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`✅ ${table}: ${result.rows[0].count} records`);
      } catch (error) {
        console.log(`❌ ${table}: ERROR -`, error instanceof Error ? error.message : 'Unknown error');
      }
    }
    
    // Check admin user
    const adminResult = await db.query('SELECT id, email, global_status FROM users WHERE email = $1', ['admin@example.com']);
    console.log('👑 Admin user:', adminResult.rows[0] ? 'Exists' : 'Missing');
    
    // Check audit logs
    const auditResult = await db.query('SELECT action, level, COUNT(*) FROM audit_logs GROUP BY action, level ORDER BY count DESC');
    console.log('📊 Audit log summary:');
    auditResult.rows.forEach(row => {
      console.log(`   ${row.action} (${row.level}): ${row.count}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Database check failed:', error);
    process.exit(1);
  }
}

checkDatabase();