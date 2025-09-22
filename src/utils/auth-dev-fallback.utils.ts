import type { Request } from 'express';
import { isAuthDevFallbackEnabled } from '../config/feature-flags';

type DevAuthFallbackTrigger =
  | 'missing_google_config'
  | 'missing_code'
  | 'missing_pkce'
  | 'flag_request';

interface DevFallbackDecision {
  shouldFallback: boolean;
  trigger?: DevAuthFallbackTrigger;
}

function googleConfigAvailable(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REDIRECT_URI
  );
}

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case '1':
      case 'true':
      case 'yes':
      case 'on':
        return true;
      default:
        return false;
    }
  }
  return false;
}

function normalizedString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

export function getDevAuthFallbackDecision(req: Request): DevFallbackDecision {
  const environment = process.env.NODE_ENV?.toLowerCase() ?? 'development';
  if (environment === 'production') {
    return { shouldFallback: false };
  }

  const hasGoogleConfig = googleConfigAvailable();
  const code = normalizedString(req.body?.code);
  const codeVerifier = normalizedString(req.body?.codeVerifier ?? req.body?.code_verifier);
  const explicitFallback = parseBooleanFlag(req.body?.devFallback ?? req.body?.dev_fallback);
  const fallbackEnabled = isAuthDevFallbackEnabled();

  if (!hasGoogleConfig) {
    return { shouldFallback: true, trigger: 'missing_google_config' };
  }

  if (fallbackEnabled) {
    if (explicitFallback) {
      return { shouldFallback: true, trigger: 'flag_request' };
    }
    if (!code) {
      return { shouldFallback: true, trigger: 'missing_code' };
    }
    if (!codeVerifier) {
      return { shouldFallback: true, trigger: 'missing_pkce' };
    }
  }

  return { shouldFallback: false };
}

export function shouldBypassGoogleAuthValidation(req: Request): boolean {
  const decision = getDevAuthFallbackDecision(req);
  return decision.shouldFallback;
}
