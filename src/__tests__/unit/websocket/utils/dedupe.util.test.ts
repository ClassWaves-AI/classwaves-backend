import { DedupeWindow, computeGroupBroadcastHash } from '../../../../services/websocket/utils/dedupe.util';

describe('DedupeWindow', () => {
  it('returns false on first occurrence and true for duplicates within window', () => {
    const dedupe = new DedupeWindow(50);
    const key = 's1:g1';
    const hash = computeGroupBroadcastHash({ status: 'ready', isReady: true, issueReason: undefined as any });

    const first = dedupe.isDuplicate(key, hash);
    const second = dedupe.isDuplicate(key, hash);

    expect(first).toBe(false);
    expect(second).toBe(true);
  });

  it('returns false after window elapses', async () => {
    const dedupe = new DedupeWindow(10);
    const key = 's1:g2';
    const hash = computeGroupBroadcastHash({ status: 'paused', isReady: false, issueReason: 'device_error' });

    expect(dedupe.isDuplicate(key, hash)).toBe(false);

    // Wait beyond window
    await new Promise((r) => setTimeout(r, 15));
    expect(dedupe.isDuplicate(key, hash)).toBe(false);
  });
});

