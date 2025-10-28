// src/utils/authUtils.ts
import jwt from 'jsonwebtoken';
import { Response } from 'express';
import { env } from '../config/env.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export interface TokenPayload {
  userId: string;
  email: string;
  globalStatus: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export const generateTokens = (res: Response, payload: TokenPayload): AuthTokens => {
  // Access token (15 minutes) - following your pattern
  const accessToken = jwt.sign(
    payload,
    env.jwtSecret,
    { expiresIn: '15m' }
  );

  // Refresh token (7 days) - following your pattern
  const refreshToken = jwt.sign(
    { userId: payload.userId },
    env.jwtRefreshSecret,
    { expiresIn: '7d' }
  );

  // Set HTTP-only cookies - following your security pattern
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000 // 15 minutes
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  return { accessToken, refreshToken };
};

export const verifyAccessToken = (token: string): TokenPayload => {
  return jwt.verify(token, env.jwtSecret) as TokenPayload;
};

export const verifyRefreshToken = (token: string): { userId: string } => {
  return jwt.verify(token, env.jwtRefreshSecret) as { userId: string };
};

export const clearTokens = (res: Response): void => {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
};

export const hashRefreshToken = (refreshToken: string): string => {
  return crypto.createHash('sha256').update(refreshToken).digest('hex');
};

export const generateResetToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

export const hashResetToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// Password utilities following your bcrypt pattern
export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
};

export const verifyPassword = async (password: string, hashedPassword: string): Promise<boolean> => {
  return bcrypt.compare(password, hashedPassword);
};