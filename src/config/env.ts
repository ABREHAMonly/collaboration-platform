// src/config/env.ts - Enhanced for Cloud
import { config } from 'dotenv';
config();

// Determine which .env file to load based on environment
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
config({ path: envFile });

const requiredVars = [
  'DATABASE_URL',
  'JWT_SECRET', 
  'JWT_REFRESH_SECRET',
  'NODE_ENV'
];

// For production, we might get DATABASE_URL from cloud provider
if (process.env.NODE_ENV === 'production') {
  // Cloud providers often use different env var names
  if (!process.env.DATABASE_URL) {
    // Try common cloud database env vars
    process.env.DATABASE_URL = process.env.DATABASE_CONNECTION_STRING 
      || process.env.POSTGRES_URL 
      || process.env.DATABASE_URL;
  }
}

requiredVars.forEach(varName => {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
});

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
  isDevelopment: process.env.NODE_ENV === 'development',
  
  // CORS origins for production
  corsOrigins: process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',') 
    : (process.env.NODE_ENV === 'production' 
        ? ['https://yourapp.vercel.app'] 
        : ['http://localhost:3000', 'http://localhost:5173'])
} as const;