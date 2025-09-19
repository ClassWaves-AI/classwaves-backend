import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { Teacher, School } from '../types/auth.types';
import { JWTConfigService } from '../config/jwt.config';

// JWT configuration constants
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const REFRESH_TOKEN_EXPIRES_IN = '30d';

// Initialize JWT config service (loads keys once at startup)
const jwtConfig = JWTConfigService.getInstance();

export interface JWTPayload {
  userId: string;
  email: string;
  schoolId: string;
  role: string;
  sessionId: string;
  type: 'access' | 'refresh';
}

export function generateAccessToken(teacher: Teacher, school: School, sessionId: string): string {
  const payload: JWTPayload = {
    userId: teacher.id,
    email: teacher.email,
    schoolId: school.id,
    role: teacher.role,
    sessionId,
    type: 'access',
  };

  const signOptions: jwt.SignOptions = {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: jwtConfig.getAlgorithm(),
  } as jwt.SignOptions;

  const signingKey = jwtConfig.getSigningKey();
  return jwt.sign(payload, signingKey, signOptions);
}

export function generateRefreshToken(teacher: Teacher, school: School, sessionId: string): string {
  const payload: JWTPayload = {
    userId: teacher.id,
    email: teacher.email,
    schoolId: school.id,
    role: teacher.role,
    sessionId,
    type: 'refresh',
  };

  const signOptions: jwt.SignOptions = {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    algorithm: jwtConfig.getAlgorithm(),
  } as jwt.SignOptions;

  const signingKey = jwtConfig.getSigningKey();
  return jwt.sign(payload, signingKey, signOptions);
}

export function verifyToken(token: string): JWTPayload {
  const verifyKey = jwtConfig.getVerificationKey();
  return jwt.verify(token, verifyKey, {
    algorithms: [jwtConfig.getAlgorithm()]
  }) as JWTPayload;
}

export function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateGroupAccessToken(groupId: string, sessionId: string): string {
  const payload = {
    groupId,
    sessionId,
    type: 'group_kiosk',
  };

  const signOptions: jwt.SignOptions = {
    algorithm: jwtConfig.getAlgorithm(),
    expiresIn: '4h',
    issuer: 'classwaves',
    audience: 'classwaves-kiosk',
  };

  return jwt.sign(payload, jwtConfig.getSigningKey(), signOptions);
}

export function getExpiresInSeconds(): number {
  // Convert JWT_EXPIRES_IN to seconds
  const expiresIn = process.env.JWT_EXPIRES_IN || JWT_EXPIRES_IN;
  const match = expiresIn.match(/^(\d+)([dhms])$/);
  if (!match) return 604800; // default 7 days to match JWT_EXPIRES_IN default

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'd': return value * 86400;
    case 'h': return value * 3600;
    case 'm': return value * 60;
    case 's': return value;
    default: return 604800; // default 7 days
  }
}

function getRefreshExpiresInSeconds(): number {
  // Convert REFRESH_TOKEN_EXPIRES_IN to seconds
  const match = REFRESH_TOKEN_EXPIRES_IN.match(/^(\d+)([dhms])$/);
  if (!match) return 2592000; // default 30 days

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'd': return value * 86400;
    case 'h': return value * 3600;
    case 'm': return value * 60;
    case 's': return value;
    default: return 2592000;
  }
}

export function getPublicKey(): string | null {
  return jwtConfig.getPublicKey();
}

export function getAlgorithm(): string {
  return jwtConfig.getAlgorithm();
}