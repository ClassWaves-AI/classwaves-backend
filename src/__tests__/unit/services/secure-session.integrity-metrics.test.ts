import { SecureSessionService } from '../../../services/secure-session.service';
import { sessionMetrics } from '../../../metrics/session.metrics';

const ORIGINAL_ENV = { ...process.env };

describe('SecureSessionService session integrity metrics', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV } as any;
    process.env.NODE_ENV = 'test';
    process.env.REDIS_USE_MOCK = '1';
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV as any;
    jest.restoreAllMocks();
  });

  it('records fingerprint mismatch when session lookup fails integrity', async () => {
    const spy = jest.spyOn(sessionMetrics, 'recordIntegrityFailure');
    const teacher: any = { id: 'teacher-1', email: 'teacher@test.dev', role: 'teacher', school_id: 'school-1' };
    const school: any = { id: 'school-1' };
    const sessionId = 'session-1';

    const initialReq: any = { ip: '127.0.0.1', headers: { 'user-agent': 'jest-agent' } };
    await SecureSessionService.storeSecureSession(sessionId, teacher, school, initialReq);

    const mismatchedReq: any = { ip: '127.0.0.1', headers: { 'user-agent': 'another-agent' } };
    const result = await SecureSessionService.getSecureSession(sessionId, mismatchedReq);

    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledWith('fingerprint_mismatch');
  });
});
