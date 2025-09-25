import { globSync } from 'glob';
import * as fs from 'fs';

describe('Architecture: controllers must not use databricksService directly', () => {
  it('ensures no direct databricksService calls exist under src/controllers', () => {
    const files = globSync('src/controllers/**/*.ts');
    const offenders: string[] = [];
    const pattern = /databricksService\.(query|queryOne|insert|update|upsert)\(/;
    const allowlist = new Set([
      'src/controllers/analytics-monitoring.controller.ts',
      'src/controllers/auth.controller.ts',
      'src/controllers/guidance-analytics.controller.ts',
      'src/controllers/health.controller.ts',
      'src/controllers/roster.controller.ts',
    ]);
    for (const file of files) {
      if (allowlist.has(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (pattern.test(content)) offenders.push(file);
    }
    if (offenders.length > 0) {
      throw new Error('Direct databricksService usage found in controllers: ' + offenders.join(', '));
    }
  });
});
