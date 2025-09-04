process.env.REDIS_USE_MOCK = '1';

/**
 * Analytics Computation — Concurrent Lock Integration Test
 *
 * Verifies that concurrent compute attempts for the same session are prevented
 * by the Redis-based lock (duplicate prevention), allowing only one to proceed.
 */

import { AnalyticsComputationService } from '../../services/analytics-computation.service';
import { databricksService } from '../../services/databricks.service';

// Ensure test mode
beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

// Mock Databricks service to return minimal but valid data for computation
jest.mock('../../services/databricks.service');

describe('AnalyticsComputationService — concurrent lock (integration)', () => {
  const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let service: AnalyticsComputationService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
    service = new AnalyticsComputationService();

    // Arrange default mocks to satisfy compute path
    (databricksService.queryOne as jest.Mock).mockImplementation(async (sql: string, params?: any[]) => {
      if (/FROM .*session_analytics_cache/i.test(sql)) {
        // No existing analytics
        return null;
      }
      if (/FROM .*classroom_sessions/i.test(sql)) {
        // Minimal session row (ended)
        return {
          id: sessionId,
          title: 'Test Session',
          status: 'ended',
          teacher_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          school_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          total_students: 6,
          actual_start: '2025-09-04T10:00:00.000Z',
          actual_end: '2025-09-04T10:45:00.000Z',
        };
      }
      if (/FROM .*analytics\.__planned_vs_actual/i.test(sql)) {
        // Presence marker used by service
        return { marker: 1 };
      }
      return null;
    });

    (databricksService.query as jest.Mock).mockImplementation(async (sql: string, params?: any[]) => {
      if (/FROM .*sessions\.student_group_members/i.test(sql)) {
        // 2 groups, 3 members each
        return [
          { id: 'g1', name: 'Group A', leader_id: 'l1', user_id: 's1', joined_at: '2025-09-04T10:02:00.000Z', expected_member_count: 3 },
          { id: 'g1', name: 'Group A', leader_id: 'l1', user_id: 's2', joined_at: '2025-09-04T10:03:00.000Z', expected_member_count: 3 },
          { id: 'g1', name: 'Group A', leader_id: 'l1', user_id: 's3', joined_at: '2025-09-04T10:04:00.000Z', expected_member_count: 3 },
          { id: 'g2', name: 'Group B', leader_id: 'l2', user_id: 's4', joined_at: '2025-09-04T10:05:00.000Z', expected_member_count: 3 },
          { id: 'g2', name: 'Group B', leader_id: 'l2', user_id: 's5', joined_at: '2025-09-04T10:06:00.000Z', expected_member_count: 3 },
          { id: 'g2', name: 'Group B', leader_id: 'l2', user_id: 's6', joined_at: '2025-09-04T10:07:00.000Z', expected_member_count: 3 },
        ];
      }
      if (/FROM .*sessions\.participants/i.test(sql)) {
        return [
          { id: 's1', group_id: 'g1', is_active: true },
          { id: 's2', group_id: 'g1', is_active: false },
          { id: 's3', group_id: 'g1', is_active: true },
          { id: 's4', group_id: 'g2', is_active: true },
          { id: 's5', group_id: 'g2', is_active: false },
          { id: 's6', group_id: 'g2', is_active: false },
        ];
      }
      if (/FROM .*analytics\.group_analytics/i.test(sql)) {
        return [
          { id: 'g1', name: 'Group A', member_count: 3, engagement_rate: 0.66 },
          { id: 'g2', name: 'Group B', member_count: 3, engagement_rate: 0.33 },
        ];
      }
      if (/FROM .*analytics\.events/i.test(sql)) {
        return [];
      }
      return [];
    });

    (databricksService.upsert as jest.Mock).mockResolvedValue(undefined);
  });

  afterAll(async () => {
    const { redisService } = await import('../../services/redis.service');
    await redisService.disconnect();
  });

  it('allows only one computation to run; others fail fast with lock', async () => {
    const concurrent = 5;
    const attempts = Array.from({ length: concurrent }, () => service.computeSessionAnalytics(sessionId));

    const results = await Promise.allSettled(attempts);

    const fulfilled = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];

    // Exactly one should succeed, others should fail due to lock
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(concurrent - 1);

    // Verify error messages indicate lock contention
    for (const rej of rejected) {
      const msg = String(rej.reason?.message || rej.reason);
      expect(/lock acquisition failed|LOCKED_BY_OTHER/i.test(msg)).toBe(true);
    }
  });
});
