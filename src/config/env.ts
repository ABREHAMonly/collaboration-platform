// src/config/env.ts - Enhanced for Cloud
import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables based on NODE_ENV
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
config({ path: join(process.cwd(), envFile) });

// Fallback to default .env if specific file doesn't exist
config();

const requiredVars = [
  'DATABASE_URL',
  'JWT_SECRET', 
  'JWT_REFRESH_SECRET'
];

// Cloud environment variable mapping
if (process.env.NODE_ENV === 'production') {
  // Map common cloud provider environment variables
  process.env.DATABASE_URL = process.env.DATABASE_URL 
    || process.env.DATABASE_CONNECTION_STRING 
    || process.env.POSTGRES_URL 
    || process.env.NEON_DATABASE_URL;
}

// Validate required environment variables
const missingVars = requiredVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

export const env = {
  databaseUrl: process.env.DATABASE_URL!,
  jwtSecret: process.env.JWT_SECRET!,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,
  nodeEnv: process.env.NODE_ENV || 'development',
  geminiApiKey: process.env.GEMINI_API_KEY,
  port: parseInt(process.env.PORT || '4000'),
  enableAI: process.env.ENABLE_AI === 'true',
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // Cloud-specific configurations
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development' || !process.env.NODE_ENV,
  
  // CORS origins for production
  corsOrigins: process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',') 
    : (process.env.NODE_ENV === 'production' 
        ? ['https://yourapp.vercel.app'] 
        : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:4000']),
        
  // SSL configuration for production
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
} as const;

// Log environment info (without secrets)
console.log('🌍 Environment:', {
  nodeEnv: env.nodeEnv,
  port: env.port,
  isProduction: env.isProduction,
  isDevelopment: env.isDevelopment,
  database: env.databaseUrl ? '✓ Configured' : '✗ Missing',
  jwt: env.jwtSecret ? '✓ Configured' : '✗ Missing',
  ai: env.geminiApiKey ? '✓ Enabled' : '✗ Disabled'
});