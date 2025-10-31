// src/config/env.ts - Enhanced for Cloud with better error handling
import { config } from 'dotenv';
import { join } from 'path';
// Add this at the very top
console.log('🔍 DEBUG - Process environment:', {
  NODE_ENV: process.env.NODE_ENV,
  RENDER: process.env.RENDER,
  RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL,
  DATABASE_URL: process.env.DATABASE_URL ? '✓ Set' : '✗ Missing',
  JWT_SECRET: process.env.JWT_SECRET ? '✓ Set' : '✗ Missing'
});
// Check if we're running on Render
const isRender = process.env.RENDER || process.env.RENDER_EXTERNAL_URL;

// FORCE production on Render
if (isRender) {
  process.env.NODE_ENV = 'production';
  console.log('🚀 Render environment detected - Forcing production mode');
}

const originalNodeEnv = process.env.NODE_ENV;
console.log('🔍 Original NODE_ENV from environment:', originalNodeEnv);

// Load environment files in correct order:
if (originalNodeEnv === 'production') {
  // Production: load .env.production first, then .env as fallback
  config({ path: join(process.cwd(), '.env.production') });
  config({ path: join(process.cwd(), '.env') });
} else {
  // Development/Test: load .env.development first, then .env as fallback
  const envFile = originalNodeEnv === 'test' ? '.env.test' : '.env.development';
  config({ path: join(process.cwd(), envFile) });
  config({ path: join(process.cwd(), '.env') });
}

// Now set NODE_ENV properly (use the original or what was set in .env files)
process.env.NODE_ENV = process.env.NODE_ENV || originalNodeEnv || 'development';

console.log('🔍 Final NODE_ENV:', process.env.NODE_ENV);
console.log('🔍 Environment files loaded for:', process.env.NODE_ENV);

// Cloud environment variable mapping
if (process.env.NODE_ENV === 'production') {
  // Map common cloud provider environment variables
  process.env.DATABASE_URL = process.env.DATABASE_URL 
    || process.env.DATABASE_CONNECTION_STRING 
    || process.env.POSTGRES_URL 
    || process.env.NEON_DATABASE_URL;

  // Ensure SSL in production
  process.env.DB_SSL = 'true';
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
  nodeEnv: process.env.NODE_ENV!,
  port: parseInt(process.env.PORT || '4000'),
  
  // Feature flags
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  enableAI: process.env.ENABLE_AI === 'true',
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // Environment detection
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development' || !process.env.NODE_ENV,
  isTest: process.env.NODE_ENV === 'test',
  
  // Enhanced SSL configuration
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false,
    ca: process.env.DB_SSL_CERT
  } : false,

  // Enhanced CORS for production
  corsOrigins: process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',') 
    : (process.env.NODE_ENV === 'production' 
        ? [
            'https://collaboration-platform-frontend.vercel.app',
            'https://collaboration-platform.vercel.app',
            'https://yourapp.vercel.app'
          ] 
        : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:4000']),

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