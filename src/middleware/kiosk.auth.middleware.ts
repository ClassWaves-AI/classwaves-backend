import { Request, Response, NextFunction } from 'express';
import { databricksService } from '../services/databricks.service';
import jwt from 'jsonwebtoken';
import { JWTConfigService } from '../config/jwt.config';
import { logger } from '../utils/logger';

// Use centralized JWT configuration for consistent algorithm handling
const jwtConfig = JWTConfigService.getInstance();

interface KioskTokenPayload {
  groupId: string;
  sessionId: string;
  iat: number;
  exp: number;
}

export interface KioskAuthRequest extends Request {
  kiosk?: {
    groupId: string;
    sessionId: string;
  };
}

export async function authenticateKiosk(req: KioskAuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Missing or invalid authentication token.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Use centralized JWT configuration for consistent algorithm verification
    const decoded = jwt.verify(
      token,
      jwtConfig.getVerificationKey(),
      { algorithms: [jwtConfig.getAlgorithm()] }
    ) as KioskTokenPayload;

    // 1. Basic payload validation
    if (!decoded.groupId || !decoded.sessionId) {
      throw new Error('Invalid token payload');
    }
    
    // 2. Check against URL parameters for match
    if (decoded.groupId !== req.params.groupId) {
        return res.status(403).json({
            error: 'FORBIDDEN',
            message: 'Token is not valid for this group.'
        });
    }

    // 3. (Optional but recommended) Check if the group/session is still active in the database
    const group = await databricksService.queryOne(
      `SELECT id FROM classwaves.sessions.student_groups WHERE id = ? AND session_id = ? AND status = 'active'`,
      [decoded.groupId, decoded.sessionId]
    );

    if (!group) {
        return res.status(403).json({
            error: 'FORBIDDEN',
            message: 'Group is not active or does not exist.'
        });
    }

    // Attach kiosk info to the request object
    req.kiosk = {
      groupId: decoded.groupId,
      sessionId: decoded.sessionId,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Kiosk token has expired.' });
    }
    if (error instanceof jwt.JsonWebTokenError) {
        return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Kiosk token is invalid.' });
    }
    logger.error('Kiosk Auth Error:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to authenticate kiosk.' });
  }
}
