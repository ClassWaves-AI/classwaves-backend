import type { Counter } from 'prom-client';
import client from 'prom-client';

type IntegrityFailureReason =
  | 'not_found'
  | 'decrypt_failed'
  | 'fingerprint_mismatch'
  | 'expired'
  | 'inactive'
  | 'integrity_error';

const sessionIntegrityFailuresCounter: Counter<'reason'> = (() => {
  const name = 'classwaves_auth_session_integrity_failures_total';
  const existing = client.register.getSingleMetric(name) as Counter<'reason'> | undefined;
  return (
    existing ||
    new client.Counter<'reason'>({
      name,
      help: 'Total number of secure session lookups that failed integrity validation',
      labelNames: ['reason'],
    })
  );
})();

const sessionStartGatedCounter: Counter<'session_id'> = (() => {
  const name = 'classwaves_session_start_gated_total';
  const existing = client.register.getSingleMetric(name) as Counter<'session_id'> | undefined;
  return (
    existing ||
    new client.Counter<'session_id'>({
      name,
      help: 'Total number of session start attempts gated by readiness checks',
      labelNames: ['session_id'],
    })
  );
})();

export const sessionMetrics = {
  recordIntegrityFailure(reason: IntegrityFailureReason): void {
    sessionIntegrityFailuresCounter.inc({ reason }, 1);
  },
};

export const getSessionStartGatedCounter = (): Counter<'session_id'> => sessionStartGatedCounter;

export type { IntegrityFailureReason };
