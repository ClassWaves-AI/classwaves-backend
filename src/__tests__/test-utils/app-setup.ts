/**
 * Test App Setup Utility
 * 
 * Creates a test Express app instance for integration testing.
 */

import express from 'express';
import { Server } from 'http';
import cookieParser from 'cookie-parser';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAnalyticsAccess } from '../../middleware/session-auth.middleware';
import guidanceAnalyticsRoutes from '../../routes/guidance-analytics.routes';
import sessionRoutes from '../../routes/session.routes';

// Mock authentication middleware for testing
const mockAuthenticate = (req: any, res: any, next: any) => {
  // Mock user data based on auth token
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'No authorization header'
    });
  }

  const token = authHeader.replace('Bearer ', '');
  
  // Mock different users based on token
  if (token === 'test-auth-token') {
    req.user = {
      id: 'test-teacher-123',
      email: 'teacher@test.edu',
      school_id: 'test-school-123',
      role: 'teacher',
      status: 'active'
    };
    req.school = {
      id: 'test-school-123',
      name: 'Test School'
    };
    req.sessionId = 'test-session-123';
  } else if (token === 'admin-auth-token') {
    req.user = {
      id: 'admin-teacher-123',
      email: 'admin@test.edu',
      school_id: 'test-school-123',
      role: 'admin',
      status: 'active'
    };
    req.school = {
      id: 'test-school-123',
      name: 'Test School'
    };
    req.sessionId = 'admin-session-123';
  } else {
    return res.status(401).json({
      error: 'INVALID_TOKEN',
      message: 'Invalid auth token'
    });
  }

  next();
};

export async function createTestApp() {
  const app = express();

  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Replace auth middleware with mock for testing
  app.use('/api/v1/analytics', mockAuthenticate);
  app.use('/api/v1/sessions', mockAuthenticate);

  // Apply routes
  app.use('/api/v1/analytics', guidanceAnalyticsRoutes);
  app.use('/api/v1/sessions', sessionRoutes);

  // Error handling
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('Test app error:', err);
    res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: err.message
    });
  });

  // Optionally start a real server only when explicitly enabled
  const enableNetwork = process.env.ENABLE_NETWORK_TESTS === '1' || process.env.ENABLE_NETWORK_TESTS === 'true';
  if (!enableNetwork) {
    console.log('⚠️ Skipping real server listen in tests (ENABLE_NETWORK_TESTS not set).');
    return { app, server: null as any, port: 0 };
  }

  // Start test server on random port when allowed
  const server = app.listen(0);
  const port = (server.address() as any)?.port;
  console.log(`Test server started on port ${port}`);
  return { app, server, port };
}
