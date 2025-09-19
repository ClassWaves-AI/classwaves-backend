import { AudioTaskQueuePort } from './audio-task-queue.port';

class InMemoryAudioTaskQueue implements AudioTaskQueuePort {
  private running = false;
  private q: Array<() => Promise<any>> = [];

  async enqueue<T>(task: () => Promise<T>): Promise<void> {
    this.q.push(task as any);
    if (!this.running) {
      this.running = true;
      // Kick in next tick to reduce hot-path contention
      setImmediate(() => this.drain().catch(() => undefined));
    }
  }

  size(): number {
    return this.q.length;
  }

  private async drain(): Promise<void> {
    while (this.q.length > 0) {
      const t = this.q.shift()!;
      try { await t(); } catch { /* best-effort */ }
    }
    this.running = false;
  }

  async shutdown(): Promise<void> {
    this.q = [];
    this.running = false;
  }
}

export const inMemoryAudioTaskQueue = new InMemoryAudioTaskQueue();

