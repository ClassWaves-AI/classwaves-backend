import * as client from 'prom-client';
import {
  getGuidancePromptActionCounter,
  getGuidanceTimeToFirstActionHistogram,
  getGuidanceWsSubscribersGauge,
  getGuidanceOnTrackSummaryEmittedCounter,
} from '../../metrics/guidance.metrics';

describe('guidance metrics singleton helpers', () => {
  afterEach(() => {
    client.register.clear();
  });

  it('reuses prompt action counter', () => {
    const first = getGuidancePromptActionCounter();
    const second = getGuidancePromptActionCounter();
    expect(second).toBe(first);
  });

  it('reuses time-to-first-action histogram', () => {
    const first = getGuidanceTimeToFirstActionHistogram();
    const second = getGuidanceTimeToFirstActionHistogram();
    expect(second).toBe(first);
  });

  it('reuses websocket subscribers gauge', () => {
    const first = getGuidanceWsSubscribersGauge();
    const second = getGuidanceWsSubscribersGauge();
    expect(second).toBe(first);
  });

  it('reuses on-track emitted counter', () => {
    const first = getGuidanceOnTrackSummaryEmittedCounter();
    const second = getGuidanceOnTrackSummaryEmittedCounter();
    expect(second).toBe(first);
  });
});

