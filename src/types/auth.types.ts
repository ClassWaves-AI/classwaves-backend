export interface GoogleUser {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  locale: string;
  hd?: string; // Google Workspace domain
}

export interface Teacher {
  id: string;
  google_id: string;
  email: string;
  name: string;
  picture?: string;
  school_id: string;
  role: 'teacher' | 'admin' | 'super_admin';
  status: 'pending' | 'active' | 'suspended' | 'deactivated';
  access_level: string;
  max_concurrent_sessions: number;
  current_sessions: number;
  grade?: string;
  subject?: string;
  timezone: string;
  features_enabled?: string;
  last_login?: Date;
  login_count: number;
  total_sessions_created: number;
  created_at: Date;
  updated_at: Date;
}

export interface School {
  id: string;
  name: string;
  domain: string;
  district_id?: string;
  subscription_status: 'active' | 'trial' | 'expired' | 'suspended';
  subscription_tier: 'basic' | 'pro' | 'enterprise';
  student_count: number;
  teacher_count: number;
  created_at: Date;
  subscription_end_date: Date;
}

export interface ClassWavesTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number;
}

import { Request } from 'express';

export interface AuthRequest extends Request {
  user?: Teacher & { schoolId?: string }; // Adding schoolId alias for compatibility
  school?: School;
  sessionId?: string;
}