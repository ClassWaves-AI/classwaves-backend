import request from 'supertest';
import express from 'express';
import sessionRoutes from '../../../routes/session.routes';
import { authenticate } from '../../../middleware/auth.middleware';
import { errorHandler } from '../../../middleware/error.middleware';
import { databricksService } from '../../../services/databricks.service';
import { redisService } from '../../../services/redis.service';
import { cachePort } from '../../../utils/cache.port.instance';
import { makeKey } from '../../../utils/key-prefix.util';

jest.mock('../../../middleware/auth.middleware');

describe('Access Code Dual-Read (prefixed/legacy)', () => {
  let app: express.Application;
  const teacher = { id: 'teacher-ac-1', email: 't@example.com', name: 'Teacher One' } as any;
  const school = { id: 'school-ac-1', name: 'School One' } as any;

  beforeEach(async () => {
    process.env.REDIS_USE_MOCK = '1';
    process.env.NODE_ENV = 'test';
    process.env.CW_CACHE_PREFIX_ENABLED = '1';
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    (authenticate as jest.Mock).mockImplementation((_req: any, _res: any, next: any) => {
      _req.user = teacher;
      _req.school = school;
      _req.sessionId = 'sess-ac-1';
      next();
    });
    app.use('/api/v1/sessions', sessionRoutes);
    app.use(errorHandler);

    // Clear Redis access code mappings between tests
    try {
      const client = redisService.getClient() as any;
      let cursor = '0';
      do {
        // @ts-ignore
        const [next, keys] = await client.scan(cursor, 'MATCH', '*access_code*', 'COUNT', 1000);
        if (Array.isArray(keys) && keys.length) await client.del(...keys);
        cursor = next;
      } while (cursor !== '0');
      // Also clear cached sessions list for isolation
      cursor = '0';
      do {
        // @ts-ignore
        const [next, keys] = await client.scan(cursor, 'MATCH', 'sessions:teacher:*', 'COUNT', 1000);
        if (Array.isArray(keys) && keys.length) await client.del(...keys);
        cursor = next;
      } while (cursor !== '0');
    } catch { /* intentionally ignored: best effort cleanup */ }
  });

  it('reads access code from prefixed mapping', async () => {
    const CODE = 'PX1';
    const sessionId = 's1';
    // Seed only prefixed mapping
    await cachePort.set(makeKey('session', sessionId, 'access_code'), CODE, 300);
    await cachePort.set(makeKey('access_code', CODE), sessionId, 300);

    jest.spyOn(databricksService, 'query').mockResolvedValue([
      {
        id: sessionId,
        teacher_id: teacher.id,
        school_id: school.id,
        title: 'Session 1', description: 'Desc', status: 'created',
        group_count: 1, student_count: 0, participation_rate: 0, engagement_score: 0,
        created_at: new Date().toISOString(),
      },
    ] as any);

    const res = await request(app).get('/api/v1/sessions').set('Authorization', 'Bearer x').expect(200);
    expect(res.body?.data?.sessions?.[0]?.accessCode).toBe(CODE);
  });

  it('falls back to legacy mapping when prefixed missing', async () => {
    const CODE = 'LX1';
    const sessionId = 's2';
    // Seed only legacy mapping
    await cachePort.set(`session:${sessionId}:access_code`, CODE, 300);
    await cachePort.set(`access_code:${CODE}`, sessionId, 300);

    jest.spyOn(databricksService, 'query').mockResolvedValue([
      {
        id: sessionId,
        teacher_id: teacher.id,
        school_id: school.id,
        title: 'Session 2', description: 'Desc', status: 'created',
        group_count: 1, student_count: 0, participation_rate: 0, engagement_score: 0,
        created_at: new Date().toISOString(),
      },
    ] as any);

    const res = await request(app).get('/api/v1/sessions').set('Authorization', 'Bearer x').expect(200);
    expect(res.body?.data?.sessions?.[0]?.accessCode).toBe(CODE);
  });
});
