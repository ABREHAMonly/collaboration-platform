// src/config/env.ts
import { config } from 'dotenv';
config();

const requiredVars = [
  'DATABASE_URL',
  'JWT_SECRET', 
  'JWT_REFRESH_SECRET',
  'NODE_ENV'
];

requiredVars.forEach(varName => {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
});

// Validate AI integration only if used
if (process.env.ENABLE_AI === 'true' && !process.env.GEMINI_API_KEY) {
  console.warn('⚠️ Gemini API key missing - AI features will be disabled');
}

export const env = {
  databaseUrl: process.env.DATABASE_URL!,
  jwtSecret: process.env.JWT_SECRET!,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,
  nodeEnv: process.env.NODE_ENV || 'development',
  geminiApiKey: process.env.GEMINI_API_KEY,
  port: parseInt(process.env.PORT || '4000'),
  enableAI: process.env.ENABLE_AI === 'true',
  logLevel: process.env.LOG_LEVEL || 'info'
} as const;