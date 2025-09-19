export class DedupeWindow {
  private readonly windowMs: number;
  private readonly map: Map<string, { hash: string; ts: number }> = new Map();

  constructor(windowMs: number = 25) {
    this.windowMs = windowMs;
  }

  // Returns true if duplicate within window, false otherwise (and records)
  isDuplicate(key: string, hash: string): boolean {
    try {
      const last = this.map.get(key);
      const now = Date.now();
      if (last && last.hash === hash && now - last.ts < this.windowMs) {
        return true;
      }
      this.map.set(key, { hash, ts: now });
      return false;
    } catch {
      return false;
    }
  }
}

export const computeGroupBroadcastHash = (payload: { status?: string; isReady?: boolean; issueReason?: string | null }): string => {
  return JSON.stringify({
    status: payload.status,
    isReady: payload.isReady,
    issueReason: payload.issueReason,
  });
};

