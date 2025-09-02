/**
 * Unit tests for admin-route-security.middleware getAdminSecurityStats
 * Verifies aggregation using canonical compliance.audit_log columns
 */

import { getAdminSecurityStats } from '../../../middleware/admin-route-security.middleware';

jest.mock('../../../services/databricks.service');
import { databricksService } from '../../../services/databricks.service';

const mockDb = databricksService as jest.Mocked<typeof databricksService>;

describe('getAdminSecurityStats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('aggregates stats from audit log rows', async () => {
    mockDb.query.mockResolvedValueOnce([
      {
        total_accesses: 3,
        denied_accesses: 1,
        security_violations: 0,
        route_path: '/api/v1/admin/settings',
        access_count: 3,
      },
      {
        total_accesses: 2,
        denied_accesses: 0,
        security_violations: 1,
        route_path: '/api/v1/admin/users',
        access_count: 2,
      },
    ] as any);

    const stats = await getAdminSecurityStats(24);

    expect(stats.totalAccesses).toBe(5);
    expect(stats.deniedAccesses).toBe(1);
    expect(stats.securityViolations).toBe(1);
    expect(stats.topRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ route: '/api/v1/admin/settings', count: 3 }),
        expect.objectContaining({ route: '/api/v1/admin/users', count: 2 }),
      ])
    );
  });

  it('returns zeros when audit table is missing', async () => {
    mockDb.query.mockRejectedValueOnce(new Error('TABLE_OR_VIEW_NOT_FOUND: compliance.audit_log'));

    const stats = await getAdminSecurityStats(24);

    expect(stats).toEqual({
      totalAccesses: 0,
      deniedAccesses: 0,
      topRoutes: [],
      securityViolations: 0,
      roleBreakdown: {},
    });
  });
});

