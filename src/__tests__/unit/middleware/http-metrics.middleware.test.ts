jest.mock('prom-client', () => {
  const counters = new Map<string, any>();
  const histos = new Map<string, any>();
  class Counter {
    name: string; inc = jest.fn();
    constructor(cfg: any){ this.name = cfg?.name; counters.set(this.name, this);} }
  class Histogram {
    name: string; startTimer = jest.fn(() => (labels?: any) => { (Histogram as any)._labels = labels; }); observe = jest.fn();
    constructor(cfg: any){ this.name = cfg?.name; histos.set(this.name, this);} }
  class Gauge { name: string; set = jest.fn(); labels = jest.fn(() => ({ set: jest.fn() })); constructor(cfg: any){ this.name = cfg?.name; } }
  const register = { getSingleMetric: (name: string) => counters.get(name) || histos.get(name) };
  return { Counter, Histogram, Gauge, register, collectDefaultMetrics: jest.fn() };
});

import request from 'supertest';
import app from '../../../app';

describe('HTTP metrics middleware', () => {
  it('increments request counter and records duration with labels', async () => {
    const res = await request(app).get('/api/v1/ready');
    expect(res.status).toBe(200);

    const client: any = require('prom-client');
    const counter = client.register.getSingleMetric('http_requests_total');
    const hist = client.register.getSingleMetric('http_request_duration_seconds');

    expect(counter).toBeDefined();
    expect(hist).toBeDefined();
    // Verify inc called with expected labels
    const incCalls = counter.inc.mock.calls;
    expect(incCalls.length).toBeGreaterThan(0);
    const labels = incCalls[incCalls.length - 1][0];
    expect(labels.method).toBe('GET');
    expect(labels.route).toBe('/api/v1/ready');
    expect(labels.status).toBe('200');
  });
});
