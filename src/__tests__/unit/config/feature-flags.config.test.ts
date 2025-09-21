import { FeatureFlags } from '@classwaves/shared';
import {
  featureFlags,
  isAuthDevFallbackEnabled,
  isDevSideEffectsToleranceEnabled,
  isLocalPostgresEnabled,
  isMetricsDbProviderLabelEnabled,
} from '../../../config/feature-flags';

const resetFlagEnv = () => {
  Object.values(FeatureFlags).forEach((key) => {
    delete process.env[key];
  });
  delete process.env.CW_AUTH_DEV_FALLBACK_ENABLED;
  delete process.env.CW_DEV_TOLERATE_SIDE_EFFECTS;
  delete process.env.CW_METRICS_DB_PROVIDER_LABEL_ENABLED;
  delete process.env.CW_DB_USE_LOCAL_POSTGRES;
};

describe('featureFlags config', () => {
  beforeEach(() => {
    resetFlagEnv();
  });

  afterAll(() => {
    resetFlagEnv();
  });

  it('treats explicit truthy strings as enabled', () => {
    process.env[FeatureFlags.AUTH_DEV_FALLBACK_ENABLED] = 'true';
    process.env[FeatureFlags.DEV_TOLERATE_SIDE_EFFECTS] = '1';
    process.env[FeatureFlags.METRICS_DB_PROVIDER_LABEL_ENABLED] = 'yes';
    process.env[FeatureFlags.DB_USE_LOCAL_POSTGRES] = 'on';

    expect(isAuthDevFallbackEnabled()).toBe(true);
    expect(isDevSideEffectsToleranceEnabled()).toBe(true);
    expect(isMetricsDbProviderLabelEnabled()).toBe(true);
    expect(isLocalPostgresEnabled()).toBe(true);
  });

  it('respects fallback CW_* variables when primary unset', () => {
    process.env.CW_AUTH_DEV_FALLBACK_ENABLED = '1';
    process.env.CW_DEV_TOLERATE_SIDE_EFFECTS = 'true';
    process.env.CW_METRICS_DB_PROVIDER_LABEL_ENABLED = 'yes';
    process.env.CW_DB_USE_LOCAL_POSTGRES = 'on';

    expect(isAuthDevFallbackEnabled()).toBe(true);
    expect(isDevSideEffectsToleranceEnabled()).toBe(true);
    expect(isMetricsDbProviderLabelEnabled()).toBe(true);
    expect(isLocalPostgresEnabled()).toBe(true);
  });

  it('returns false for unset or falsy values', () => {
    process.env[FeatureFlags.AUTH_DEV_FALLBACK_ENABLED] = '0';
    process.env.CW_DEV_TOLERATE_SIDE_EFFECTS = 'false';

    expect(isAuthDevFallbackEnabled()).toBe(false);
    expect(isDevSideEffectsToleranceEnabled()).toBe(false);
    expect(isMetricsDbProviderLabelEnabled()).toBe(false);
    expect(isLocalPostgresEnabled()).toBe(false);
  });

  it('exposes evaluators map', () => {
    expect(featureFlags.isAuthDevFallbackEnabled).toBe(isAuthDevFallbackEnabled);
    expect(featureFlags.isDevSideEffectsToleranceEnabled).toBe(isDevSideEffectsToleranceEnabled);
  });
});
