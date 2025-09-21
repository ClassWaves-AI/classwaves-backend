import { logger } from './logger';
import { isDevSideEffectsToleranceEnabled } from '../config/feature-flags';
import { recordSideEffectSuppressed } from '../metrics/side-effects.metrics';

interface DevSuppressOptions<T> {
  fallbackValue?: T;
  context?: Record<string, unknown>;
  swallowInProduction?: boolean;
}

const buildErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export async function devSuppress<T>(
  label: string,
  effect: () => Promise<T> | T,
  options: DevSuppressOptions<T> = {}
): Promise<T | undefined> {
  const environment = (process.env.NODE_ENV || 'development').toLowerCase();
  const suppressInLowerEnv = environment !== 'production' && isDevSideEffectsToleranceEnabled();
  const swallowInProd = options.swallowInProduction === true;

  try {
    return await Promise.resolve(effect());
  } catch (error) {
    const shouldSuppress = suppressInLowerEnv || swallowInProd;
    if (!shouldSuppress) {
      throw error;
    }

    recordSideEffectSuppressed(label, environment);

    logger.warn('side_effect_suppressed', {
      label,
      environment,
      ...options.context,
      error: buildErrorMessage(error),
    });

    return options.fallbackValue;
  }
}

