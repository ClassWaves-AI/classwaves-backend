import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWTConfigService } from '../config/jwt.config';
import { verifyToken } from '../utils/jwt.utils';

const jwtConfig = JWTConfigService.getInstance();

export interface AudioUploadAuthRequest extends Request {
  user?: any;
  kiosk?: { groupId: string; sessionId: string };
}

export function authenticateAudioUpload(req: AudioUploadAuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing bearer token' });
    }
    const token = authHeader.slice(7);

    // Try access token (teacher/admin)
    try {
      const payload: any = verifyToken(token);
      if (payload?.type === 'access') {
        // Minimal user shape for downstream usage
        req.user = {
          id: payload.userId,
          email: payload.email,
          role: payload.role,
          school_id: payload.schoolId,
        };
        return next();
      }
    } catch {
      // fallthrough to kiosk token
    }

    // Try kiosk group token (student uploader)
    try {
      const decoded = jwt.verify(token, jwtConfig.getVerificationKey(), { algorithms: [jwtConfig.getAlgorithm()] }) as any;
      if (decoded && decoded.groupId && decoded.sessionId) {
        req.kiosk = { groupId: String(decoded.groupId), sessionId: String(decoded.sessionId) };
        return next();
      }
    } catch { /* intentionally ignored: best effort cleanup */ }

    return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Invalid or expired token' });
  } catch (e) {
    return res.status(500).json({ error: 'AUTHENTICATION_ERROR', message: 'Failed to authenticate upload' });
  }
}

