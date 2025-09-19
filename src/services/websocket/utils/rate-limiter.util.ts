export interface KeyCounterClient {
  incr(key: string): Promise<number> | number;
  expire(key: string, seconds: number): Promise<any> | any;
}

export class RedisRateLimiter {
  private client: KeyCounterClient;

  constructor(client: KeyCounterClient) {
    this.client = client;
  }

  async allow(key: string, max: number, windowSec: number): Promise<boolean> {
    try {
      const count = await this.client.incr(key);
      if (count === 1) {
        await this.client.expire(key, windowSec);
      }
      return count <= max;
    } catch {
      // Fail open if Redis unavailable
      return true;
    }
  }
}

