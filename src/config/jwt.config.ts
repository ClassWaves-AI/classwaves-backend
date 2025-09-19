import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

/**
 * JWTConfigService - Centralized JWT configuration and algorithm detection
 * 
 * Features:
 * - Single source of truth for JWT algorithm selection
 * - Cached RSA key loading (loaded once at startup)
 * - Performance optimized (no file system reads on token generation)
 * - Consistent behavior across all JWT services
 */
export class JWTConfigService {
  private static instance: JWTConfigService | null = null;
  private static isInitialized = false;

  // Cached configuration values
  private readonly useRS256: boolean;
  private readonly privateKey: string;
  private readonly publicKey: string;
  private readonly algorithm: 'RS256' | 'HS256';
  private readonly jwtSecret: string;

  private constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'classwaves-jwt-secret';
    
    // Load RSA keys once at initialization
    const { privateKey, publicKey, useRS256 } = this.loadRSAKeys();
    
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.useRS256 = useRS256;
    this.algorithm = useRS256 ? 'RS256' : 'HS256';

    logger.debug(`🔐 JWT Config initialized: Algorithm=${this.algorithm}, RSA Keys=${useRS256 ? 'Loaded' : 'Fallback to HS256'}`);
  }

  /**
   * Get singleton instance (lazy initialization)
   */
  public static getInstance(): JWTConfigService {
    if (!JWTConfigService.instance || !JWTConfigService.isInitialized) {
      JWTConfigService.instance = new JWTConfigService();
      JWTConfigService.isInitialized = true;
    }
    return JWTConfigService.instance;
  }

  /**
   * Load RSA keys from file system (called once at startup)
   */
  private loadRSAKeys(): { privateKey: string; publicKey: string; useRS256: boolean } {
    const privateKeyPath = path.join(process.cwd(), 'keys', 'private.pem');
    const publicKeyPath = path.join(process.cwd(), 'keys', 'public.pem');

    try {
      const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
      const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
      
      if (privateKey && publicKey) {
        return { privateKey, publicKey, useRS256: true };
      }
    } catch (error) {
      logger.warn('🔑 RSA keys not found, falling back to HS256 with secret', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { privateKey: '', publicKey: '', useRS256: false };
  }

  /**
   * Get JWT algorithm (RS256 if RSA keys available, HS256 otherwise)
   */
  public getAlgorithm(): 'RS256' | 'HS256' {
    return this.algorithm;
  }

  /**
   * Get signing key for token generation
   */
  public getSigningKey(): string {
    return this.useRS256 ? this.privateKey : this.jwtSecret;
  }

  /**
   * Get verification key for token verification
   */
  public getVerificationKey(): string {
    return this.useRS256 ? this.publicKey : this.jwtSecret;
  }

  /**
   * Check if RSA keys are available
   */
  public isUsingRS256(): boolean {
    return this.useRS256;
  }

  /**
   * Get public key (for external use)
   */
  public getPublicKey(): string | null {
    return this.useRS256 ? this.publicKey : null;
  }

  /**
   * Get JWT secret (for HS256 fallback)
   */
  public getJWTSecret(): string {
    return this.jwtSecret;
  }

  /**
   * Static convenience methods (backward compatibility)
   */
  public static getAlgorithm(): 'RS256' | 'HS256' {
    return JWTConfigService.getInstance().getAlgorithm();
  }

  public static getSigningKey(): string {
    return JWTConfigService.getInstance().getSigningKey();
  }

  public static getVerificationKey(): string {
    return JWTConfigService.getInstance().getVerificationKey();
  }

  public static isUsingRS256(): boolean {
    return JWTConfigService.getInstance().isUsingRS256();
  }

  public static getPublicKey(): string | null {
    return JWTConfigService.getInstance().getPublicKey();
  }
}
