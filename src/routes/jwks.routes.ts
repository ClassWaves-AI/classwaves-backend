import { Router } from 'express';
import * as crypto from 'crypto';
import { getPublicKey, getAlgorithm } from '../utils/jwt.utils';
import { logger } from '../utils/logger';

const router = Router();

// Convert PEM to JWK format
function pemToJwk(pem: string): any {
  const publicKey = crypto.createPublicKey(pem);
  const jwk = publicKey.export({ format: 'jwk' });
  
  return {
    ...jwk,
    alg: 'RS256',
    use: 'sig',
    kid: crypto.createHash('sha256').update(pem).digest('hex').substring(0, 16),
  };
}

// JWKS endpoint for public key distribution
router.get('/.well-known/jwks.json', (req, res) => {
  const publicKey = getPublicKey();
  const algorithm = getAlgorithm();
  
  if (!publicKey || algorithm !== 'RS256') {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'JWKS not available in HS256 mode',
    });
  }
  
  try {
    const jwk = pemToJwk(publicKey);
    
    res.json({
      keys: [jwk],
    });
  } catch (error) {
    logger.error('Error generating JWKS:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to generate JWKS',
    });
  }
});

// Public key endpoint (for compatibility)
router.get('/api/v1/auth/public-key', (req, res) => {
  const publicKey = getPublicKey();
  const algorithm = getAlgorithm();
  
  if (!publicKey) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Public key not available in HS256 mode',
    });
  }
  
  res.json({
    publicKey,
    algorithm,
    format: 'PEM',
  });
});

export default router;