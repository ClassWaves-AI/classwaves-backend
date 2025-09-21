import { FeatureFlags } from '@classwaves/shared';

const mockRecord = jest.fn();
const mockWarn = jest.fn();

jest.mock('../../../metrics/side-effects.metrics', () => ({
  recordSideEffectSuppressed: (...args: unknown[]) => mockRecord(...args),
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockWarn(...args),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('devSuppress', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    mockRecord.mockClear();
    mockWarn.mockClear();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('suppresses failures in development when flag enabled', async () => {
    process.env.NODE_ENV = 'development';
    process.env[FeatureFlags.DEV_TOLERATE_SIDE_EFFECTS] = '1';
    const { devSuppress } = await import('../../../utils/dev-suppress');

    await expect(
      devSuppress('test_effect', async () => {
        throw new Error('boom');
      })
    ).resolves.toBeUndefined();

    expect(mockRecord).toHaveBeenCalledWith('test_effect', 'development');
    expect(mockWarn).toHaveBeenCalledWith('side_effect_suppressed', expect.objectContaining({ label: 'test_effect', environment: 'development' }));
  });

  it('respects fallback value', async () => {
    process.env.NODE_ENV = 'development';
    process.env[FeatureFlags.DEV_TOLERATE_SIDE_EFFECTS] = '1';
    const { devSuppress } = await import('../../../utils/dev-suppress');

    await expect(
      devSuppress('with_fallback', () => {
        throw new Error('boom');
      }, { fallbackValue: 'SAFE' })
    ).resolves.toBe('SAFE');
  });

  it('rethrows in production even when flag enabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env[FeatureFlags.DEV_TOLERATE_SIDE_EFFECTS] = '1';
    const { devSuppress } = await import('../../../utils/dev-suppress');

    await expect(
      devSuppress('prod_effect', () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('obeys swallowInProduction option', async () => {
    process.env.NODE_ENV = 'production';
    const { devSuppress } = await import('../../../utils/dev-suppress');

    await expect(
      devSuppress('prod_swallow', () => {
        throw new Error('boom');
      }, { swallowInProduction: true })
    ).resolves.toBeUndefined();

    expect(mockRecord).toHaveBeenCalledWith('prod_swallow', 'production');
  });
});

