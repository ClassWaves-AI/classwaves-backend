import { ZodError, z } from 'zod';
import { buildError, buildOk, mapZodIssues } from '../../../utils/api-response';
import { ErrorCodes } from '@classwaves/shared';

describe('api-response helpers', () => {
  it('buildOk returns standard shape', () => {
    const resp = buildOk({ hello: 'world' }, 'req-1');
    expect(resp.success).toBe(true);
    expect(resp.data).toEqual({ hello: 'world' });
    expect(resp.timestamp).toBeTruthy();
    expect(resp.requestId).toBe('req-1');
  });

  it('buildError returns standard error shape', () => {
    const resp = buildError(ErrorCodes.INVALID_INPUT, 'Bad input', { field: 'name' }, 'abc');
    expect(resp.success).toBe(false);
    expect(resp.error?.code).toBe(ErrorCodes.INVALID_INPUT);
    expect(resp.error?.message).toBe('Bad input');
    expect(resp.error?.details).toEqual({ field: 'name' });
    expect(resp.requestId).toBe('abc');
  });

  it('mapZodIssues returns normalized issue list', () => {
    const schema = z.object({ n: z.number().int().min(1) });
    const result = schema.safeParse({ n: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const details = mapZodIssues(result.error);
      expect(Array.isArray(details.issues)).toBe(true);
      expect(details.issues[0]).toHaveProperty('path');
      expect(details.issues[0]).toHaveProperty('message');
      expect(details.issues[0]).toHaveProperty('code');
    }
  });
});

