// src/utils/debug.ts - Simple debugging helper
export class DebugHelper {
  static logDatabaseStats() {
    console.log('📊 Database Connection Status:');
    console.log('   - Environment:', process.env.NODE_ENV);
    console.log('   - Database URL:', process.env.DATABASE_URL ? '✓ Set' : '✗ Missing');
  }

  static logServerInfo() {
    console.log('🚀 Server Information:');
    console.log('   - Port:', process.env.PORT || 4000);
    console.log('   - Node Environment:', process.env.NODE_ENV);
    console.log('   - Bun Version:', process.version);
  }
}