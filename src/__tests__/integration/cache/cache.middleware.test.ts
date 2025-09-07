import request from 'supertest';
import express from 'express';
import sessionRoutes from '../../../routes/session.routes';
import { authenticate } from '../../../middleware/auth.middleware';
import { errorHandler } from '../../../middleware/error.middleware';
import { databricksService } from '../../../services/databricks.service';
import { redisService } from '../../../services/redis.service';

jest.mock('../../../middleware/auth.middleware');

describe('Cache Middleware Integration - Sessions List', () => {
  let app: express.Application;
  const teacher = { id: 'teacher-int-1', email: 't@example.com', name: 'Teacher One' } as any;
  const school = { id: 'school-int-1', name: 'School One' } as any;

  beforeAll(() => {
    process.env.REDIS_USE_MOCK = '1';
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    (authenticate as jest.Mock).mockImplementation((_req: any, _res: any, next: any) => {
      _req.user = teacher;
      _req.school = school;
      _req.sessionId = 'sess-int-1';
      next();
    });
    app.use('/api/v1/sessions', sessionRoutes);
    app.use(errorHandler);

    // Clear Redis keys via the mock client
    try {
      const client = redisService.getClient() as any;
      if (client.scan) {
        let cursor = '0';
        do {
          const [next, keys] = await client.scan(cursor, 'MATCH', 'sessions:teacher:*', 'COUNT', 1000);
          if (Array.isArray(keys) && keys.length) await client.del(...keys);
          cursor = next;
        } while (cursor !== '0');
      }
    } catch {}
  });

  it('serves from cache on second call (miss → hit)', async () => {
    const spy = jest.spyOn(databricksService, 'query').mockResolvedValue([
      {
        id: 's1',
        teacher_id: teacher.id,
        school_id: school.id,
        title: 'Session 1',
        description: 'Desc',
        status: 'created',
        group_count: 1,
        student_count: 0,
        created_at: new Date().toISOString(),
      },
    ] as any);

    // First call -> MISS (DB hit expected)
    const res1 = await request(app)
      .get('/api/v1/sessions')
      .set('Authorization', 'Bearer dummy')
      .expect(200);
    expect(res1.body.success).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);

    // Second call -> HIT (no new DB call expected)
    const res2 = await request(app)
      .get('/api/v1/sessions')
      .set('Authorization', 'Bearer dummy')
      .expect(200);
    expect(res2.body.success).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

