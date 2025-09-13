export interface IdempotencyPort {
  /**
   * Acquire a one-time lock for a key. Returns true if acquired, false if it already exists.
   * Uses TTL in milliseconds for fine-grained control.
   */
  acquireOnce(key: string, ttlMs: number): Promise<boolean>;

  /**
   * Run a function only if the key is acquired (via NX). Returns whether it executed and the result if so.
   */
  withIdempotency<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<{ executed: boolean; result?: T }>;
}

