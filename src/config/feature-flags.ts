import { FeatureFlags } from '@classwaves/shared';

const truthy = (value: string | undefined): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const readFlag = (primary: string, fallback?: string): boolean => {
  const direct = process.env[primary];
  if (direct !== undefined) return truthy(direct);
  if (fallback) {
    const alt = process.env[fallback];
    if (alt !== undefined) return truthy(alt);
  }
  return false;
};

export const isAuthDevFallbackEnabled = (): boolean =>
  readFlag(FeatureFlags.AUTH_DEV_FALLBACK_ENABLED, 'CW_AUTH_DEV_FALLBACK_ENABLED');

export const isDevSideEffectsToleranceEnabled = (): boolean =>
  readFlag(FeatureFlags.DEV_TOLERATE_SIDE_EFFECTS, 'CW_DEV_TOLERATE_SIDE_EFFECTS');

export const isMetricsDbProviderLabelEnabled = (): boolean =>
  readFlag(FeatureFlags.METRICS_DB_PROVIDER_LABEL_ENABLED, 'CW_METRICS_DB_PROVIDER_LABEL_ENABLED');

export const isLocalPostgresEnabled = (): boolean =>
  readFlag(FeatureFlags.DB_USE_LOCAL_POSTGRES, 'CW_DB_USE_LOCAL_POSTGRES');

export const featureFlags = {
  isAuthDevFallbackEnabled,
  isDevSideEffectsToleranceEnabled,
  isMetricsDbProviderLabelEnabled,
  isLocalPostgresEnabled,
};

export type FeatureFlagEvaluators = typeof featureFlags;
