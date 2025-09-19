export interface AudioTaskQueuePort {
  enqueue<T>(task: () => Promise<T>, opts?: { label?: string }): Promise<void>;
  size(): number;
  shutdown?(): Promise<void>;
}

// Default in-memory singleton accessor (late-bound to avoid test import timing issues)
let _queueInstance: AudioTaskQueuePort | null = null;
export const getAudioTaskQueue = async (): Promise<AudioTaskQueuePort> => {
  if (_queueInstance) return _queueInstance;
  const mod = await import('./in-memory-audio-task-queue');
  _queueInstance = mod.inMemoryAudioTaskQueue;
  return _queueInstance;
};

