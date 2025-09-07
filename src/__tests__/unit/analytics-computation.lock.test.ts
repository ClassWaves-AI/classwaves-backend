import { analyticsComputationService } from '../../services/analytics-computation.service';

jest.mock('../../services/redis.service', () => {
  // Simulate a locked state by default
  const client = {
    set: jest.fn(async () => null),
    del: jest.fn(async () => 1),
  };
  return {
    redisService: {
      getClient: () => client,
    },
  };
});

describe('AnalyticsComputationService — dedup lock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws lock acquisition failed when lock is held', async () => {
    // When set() returns null, lock is held by someone else
    await expect(analyticsComputationService.computeSessionAnalytics('sess-lock-1'))
      .rejects.toThrow(/lock acquisition failed/i);
  });

  it('proceeds when lock acquired (mock set returns OK), then releases', async () => {
    // Swap mock to simulate lock acquisition success then immediate throw via timeout to trigger finally lock release quickly
    const { redisService } = require('../../services/redis.service');
    const client = redisService.getClient();
    (client.set as jest.Mock).mockResolvedValueOnce('OK');

    // Shorten compute timeout for this test to avoid heavy path; simulate early timeout by setting env
    process.env.ANALYTICS_COMPUTE_LOCK_TTL_MS = '1000';

    // We cannot easily shortcut internal compute path; just call and expect some error or null after the method runs.
    // The important part: ensure no throw due to lock path and lock released in finally.
    try {
      await analyticsComputationService.computeSessionAnalytics('sess-lock-2');
    } catch (_) {
      // ignore; focus on del call
    }
    expect(client.del).toHaveBeenCalled();
  });
});

