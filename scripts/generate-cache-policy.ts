/*
 * Generates a machine-readable Cache Policy SOT from CacheTTLPolicy
 */
import { CacheTTLPolicy } from '../src/services/cache-ttl.policy';
import * as fs from 'fs';

type CachePolicySOT = {
  generatedAt: string;
  policy: typeof CacheTTLPolicy;
  keyspaces: Array<{
    prefix: string;
    description: string;
    examples: string[];
    ttl?: number;
  }>;
};

const sot: CachePolicySOT = {
  generatedAt: new Date().toISOString(),
  policy: CacheTTLPolicy,
  keyspaces: [
    {
      prefix: 'query_cache:session-list',
      description: 'Cached teacher session list queries',
      examples: [
        'query_cache:session-list:teacher:{teacherId}',
        'cw:{env}:query_cache:session-list:teacher:{teacherId}'
      ],
      ttl: CacheTTLPolicy.query['session-list'],
    },
    {
      prefix: 'query_cache:session-detail',
      description: 'Cached session detail queries',
      examples: [
        'query_cache:session-detail:session:{sessionId}',
        'cw:{env}:query_cache:session-detail:session:{sessionId}'
      ],
      ttl: CacheTTLPolicy.query['session-detail'],
    },
    {
      prefix: 'query_cache:teacher-analytics',
      description: 'Cached teacher analytics queries',
      examples: [
        'query_cache:teacher-analytics:teacher:{teacherId}',
        'cw:{env}:query_cache:teacher-analytics:teacher:{teacherId}'
      ],
      ttl: CacheTTLPolicy.query['teacher-analytics'],
    },
    {
      prefix: 'query_cache:session-analytics',
      description: 'Cached session analytics queries',
      examples: [
        'query_cache:session-analytics:session:{sessionId}',
        'cw:{env}:query_cache:session-analytics:session:{sessionId}'
      ],
      ttl: CacheTTLPolicy.query['session-analytics'],
    },
    {
      prefix: 'csrf:*',
      description: 'CSRF tokens',
      examples: ['csrf:{token}', 'cw:{env}:csrf:{token}'],
      ttl: CacheTTLPolicy.csrf,
    },
    {
      prefix: 'secure_session:*',
      description: 'Secure teacher session envelope',
      examples: ['secure_session:{sessionId}', 'cw:{env}:secure_session:{sessionId}'],
      ttl: CacheTTLPolicy.secureSession,
    },
  ],
};

const outFile = process.env.OUT_FILE;
const json = JSON.stringify(sot, null, 2);
if (outFile) {
  fs.writeFileSync(outFile, json, 'utf8');
  console.log(`Wrote cache policy SOT to ${outFile}`);
} else {
  console.log(json);
}

