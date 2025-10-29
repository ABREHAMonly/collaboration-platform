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

export const generateTokens = (payload: TokenPayload): AuthTokens => {
  // Access token (15 minutes)
  const accessToken = jwt.sign(
    payload,
    env.jwtSecret,
    { expiresIn: '15m' }
  );

  // Refresh token (7 days)
  const refreshToken = jwt.sign(
    { userId: payload.userId, type: 'refresh' },
    env.jwtRefreshSecret,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
};

export const setTokenCookies = (res: Response, tokens: AuthTokens): void => {
  // Set HTTP-only cookies
  res.cookie('accessToken', tokens.accessToken, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000 // 15 minutes
  });

  res.cookie('refreshToken', tokens.refreshToken, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
};

export const verifyAccessToken = (token: string): TokenPayload => {
  try {
    return jwt.verify(token, env.jwtSecret) as TokenPayload;
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid access token');
    }
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Access token expired');
    }
    throw error;
  }
};

export const verifyRefreshToken = (token: string): { userId: string; type: string } => {
  try {
    return jwt.verify(token, env.jwtRefreshSecret) as { userId: string; type: string };
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid refresh token');
    }
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Refresh token expired');
    }
    throw error;
  }
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

// Password utilities
export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
};

export const verifyPassword = async (password: string, hashedPassword: string): Promise<boolean> => {
  return bcrypt.compare(password, hashedPassword);
};

// Token expiration utilities
export const getTokenExpiration = (token: string): Date => {
  const decoded = jwt.decode(token) as any;
  return new Date(decoded.exp * 1000);
};

export const isTokenExpiringSoon = (token: string, thresholdMinutes: number = 5): boolean => {
  const expiration = getTokenExpiration(token);
  const now = new Date();
  const diffMs = expiration.getTime() - now.getTime();
  return diffMs < (thresholdMinutes * 60 * 1000);
};