import { FeatureFlags } from '@classwaves/shared';

function isTruthy(value: string | undefined | null): boolean {
  if (!value) return false;
  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    default:
      return false;
  }
}

function isNonProduction(): boolean {
  const env = process.env.NODE_ENV?.toLowerCase() ?? 'development';
  return env !== 'production';
}

export function isLocalDbEnabled(): boolean {
  if (!isNonProduction()) return false;
  if (isTruthy(process.env[FeatureFlags.DB_USE_LOCAL_POSTGRES])) return true;
  if (isTruthy(process.env.CW_DB_USE_LOCAL_POSTGRES)) return true;
  if (isTruthy(process.env.USE_LOCAL_DB)) return true;
  return false;
}

export function isAuthDevFallbackEnabled(): boolean {
  if (!isNonProduction()) return false;
  if (isTruthy(process.env[FeatureFlags.AUTH_DEV_FALLBACK_ENABLED])) return true;
  if (isTruthy(process.env.CW_AUTH_DEV_FALLBACK_ENABLED)) return true;
  // Default-on when local DB is enabled for smoother dev flows.
  if (isLocalDbEnabled()) return true;
  return false;
}

export function isGuidanceEpisodesEnabled(): boolean {
  if (isTruthy(process.env[FeatureFlags.GUIDANCE_EPISODES_ENABLED])) return true;
  if (isTruthy(process.env.CW_GUIDANCE_EPISODES_ENABLED)) return true;
  return false;
}
