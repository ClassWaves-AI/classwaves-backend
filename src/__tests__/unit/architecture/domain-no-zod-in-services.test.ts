import { globSync } from 'glob';
import * as fs from 'fs';

describe('Architecture: domain services do not import zod', () => {
  it('ensures no direct zod imports exist under src/services (excluding adapters/ports)', () => {
    const files = globSync('src/services/**/*.ts', {
      ignore: [
        'src/services/**/ports/**/*.ts',
        'src/services/**/queue/**/*.ts', // queue ports may be fine
      ],
    });
    const offenders: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const hasZod = /from\s+['"]zod['"]/i.test(content);
      if (hasZod) offenders.push(file);
    }
    if (offenders.length > 0) {
      throw new Error('Zod imports found in domain services: ' + offenders.join(', '));
    }
  });
});

