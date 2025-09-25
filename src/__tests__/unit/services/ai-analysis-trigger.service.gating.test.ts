import { aiAnalysisTriggerService } from '../../../services/ai-analysis-trigger.service';

// prom-client stub
jest.mock('prom-client', () => {
  const metrics = new Map<string, any>();
  class Counter {
    name: string;
    inc = jest.fn();
    constructor(cfg: any) {
      this.name = cfg?.name;
      metrics.set(this.name, this);
    }
  }
  class Histogram {
    name: string;
    observe = jest.fn();
    constructor(cfg: any) {
      this.name = cfg?.name;
      metrics.set(this.name, this);
    }
  }
  class Gauge {
    name: string;
    inc = jest.fn();
    dec = jest.fn();
    set = jest.fn();
    constructor(cfg: any) {
      this.name = cfg?.name;
      metrics.set(this.name, this);
    }
  }
  const register = {
    getSingleMetric: (name: string) => metrics.get(name),
  };
  return { Counter, Histogram, Gauge, register };
});

// Redis flags set to ended
jest.mock('../../../services/redis.service', () => ({
  redisService: { getClient: () => ({ get: jest.fn(async (key: string) => (key.includes('ws:session:status') ? 'ended' : null)) }) }
}));

jest.mock('../../../services/ai-analysis-buffer.service', () => ({
  aiAnalysisBufferService: { getBufferedTranscripts: jest.fn() }
}));

describe('AI Analysis Trigger Service — gating on ending/ended flags', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('returns early and does not read buffers when ending/ended', async () => {
    const { aiAnalysisBufferService } = require('../../../services/ai-analysis-buffer.service');
    const getBufferedTranscripts = aiAnalysisBufferService.getBufferedTranscripts as jest.Mock;
    await aiAnalysisTriggerService.checkAndTriggerAIAnalysis('g1', 's1', 't1');
    expect(getBufferedTranscripts).not.toHaveBeenCalled();
  });
});
