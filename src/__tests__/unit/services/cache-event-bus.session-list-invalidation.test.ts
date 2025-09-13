import { cacheEventBus } from '../../../services/cache-event-bus.service';

jest.mock('../../../services/cache-manager.service', () => ({
  cacheManager: {
    invalidateByTag: jest.fn().mockResolvedValue(1),
    getHealthStatus: jest.fn(),
    getMetrics: jest.fn(),
  }
}));

jest.mock('../../../services/tag-epoch.service', () => ({
  bumpTagEpoch: jest.fn().mockResolvedValue(1),
}));

describe('Cache Event Bus — sessions list invalidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invalidates teacher session lists and bumps epoch on session.status_changed', async () => {
    const { cacheManager } = require('../../../services/cache-manager.service');
    const { bumpTagEpoch } = require('../../../services/tag-epoch.service');

    await cacheEventBus.sessionStatusChanged('sess-1', 'teacher-7', 'created', 'active');

    expect(cacheManager.invalidateByTag).toHaveBeenCalledWith('session:sess-1');
    expect(cacheManager.invalidateByTag).toHaveBeenCalledWith('teacher:teacher-7');
    expect(bumpTagEpoch).toHaveBeenCalledWith('session:sess-1');
    expect(bumpTagEpoch).toHaveBeenCalledWith('teacher:teacher-7');
  });
});

