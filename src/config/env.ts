// src/config/env.ts - Enhanced for Cloud with better error handling
import { config } from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables based on NODE_ENV
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
config({ path: join(process.cwd(), envFile) });

// Fallback to default .env if specific file doesn't exist
config({ path: join(process.cwd(), '.env') });

// Cloud environment variable mapping
if (process.env.NODE_ENV === 'production') {
  // Map common cloud provider environment variables
  process.env.DATABASE_URL = process.env.DATABASE_URL 
    || process.env.DATABASE_CONNECTION_STRING 
    || process.env.POSTGRES_URL 
    || process.env.NEON_DATABASE_URL
    || process.env.DATABASE_URL; // Keep original if exists
}

// Required environment variables
const requiredVars = [
  'DATABASE_URL',
  'JWT_SECRET', 
  'JWT_REFRESH_SECRET'
];

// Validate required environment variables
const missingVars = requiredVars.filter(varName => {
  const value = process.env[varName];
  return !value || value === 'undefined' || value === 'null';
});

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars);
  
  // In production, throw error; in development, use fallbacks
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  } else {
    console.warn('⚠️ Using development fallbacks for missing environment variables');
    
    // Development fallbacks
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = 'postgresql://admin:password@localhost:5432/collaboration_platform';
    }
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'dev-jwt-secret-change-in-production';
    }
    if (!process.env.JWT_REFRESH_SECRET) {
      process.env.JWT_REFRESH_SECRET = 'dev-refresh-secret-change-in-production';
    }
  }
}

export const env = {
  // Core configuration
  databaseUrl: process.env.DATABASE_URL!,
  jwtSecret: process.env.JWT_SECRET!,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000'),
  
  // Feature flags
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  enableAI: process.env.ENABLE_AI === 'true',
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // Environment detection
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development' || !process.env.NODE_ENV,
  isTest: process.env.NODE_ENV === 'test',
  
  // CORS configuration
  corsOrigins: process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',') 
    : (process.env.NODE_ENV === 'production' 
        ? ['https://yourapp.vercel.app', 'https://collaboration-platform-9ngo.onrender.com'] 
        : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:4000']),
        
  // SSL configuration
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  
  // JWT Expiry
  jwtAccessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
  jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d'
} as const;

// Log environment info (without secrets)
console.log('🌍 Environment Configuration:', {
  nodeEnv: env.nodeEnv,
  port: env.port,
  isProduction: env.isProduction,
  isDevelopment: env.isDevelopment,
  database: env.databaseUrl ? '✓ Configured' : '✗ Missing',
  jwt: env.jwtSecret ? '✓ Configured' : '✗ Missing',
  ai: env.geminiApiKey ? '✓ Enabled' : '✗ Disabled',
  corsOrigins: env.corsOrigins.length
});