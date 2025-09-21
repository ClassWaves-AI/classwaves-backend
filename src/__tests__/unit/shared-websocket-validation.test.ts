import {
  SessionStatusUpdateSchema,
  GroupJoinLeaveSchema,
  GroupLeaderReadySchema,
  WaveListenerIssueSchema,
} from '../../utils/validation.schemas';

describe('Shared WS validation schemas', () => {
  it('validates session status update', () => {
    const ok = SessionStatusUpdateSchema.safeParse({ sessionId: 's1', status: 'paused' });
    expect(ok.success).toBe(true);
    const bad = SessionStatusUpdateSchema.safeParse({ sessionId: '', status: 'bogus' });
    expect(bad.success).toBe(false);
  });

  it('validates group join/leave payload', () => {
    const ok = GroupJoinLeaveSchema.safeParse({ groupId: 'g1', sessionId: 's1' });
    expect(ok.success).toBe(true);
    const bad = GroupJoinLeaveSchema.safeParse({ groupId: '', sessionId: '' });
    expect(bad.success).toBe(false);
  });

  it('validates group leader readiness', () => {
    const ok = GroupLeaderReadySchema.safeParse({ groupId: 'g1', sessionId: 's1', ready: true });
    expect(ok.success).toBe(true);
    const bad = GroupLeaderReadySchema.safeParse({ groupId: 'g1', sessionId: 's1', ready: 'yes' });
    expect(bad.success).toBe(false);
  });

  it('validates WaveListener issue payload', () => {
    const ok = WaveListenerIssueSchema.safeParse({ groupId: 'g1', sessionId: 's1', reason: 'device_error' });
    expect(ok.success).toBe(true);
    const bad = WaveListenerIssueSchema.safeParse({ groupId: 'g1', sessionId: 's1', reason: 'other' });
    expect(bad.success).toBe(false);
  });
});
