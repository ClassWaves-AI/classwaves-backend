import fs from 'fs';
import path from 'path';

let cachedHash: string | undefined;
let attemptedLoad = false;

const hashPaths = [
  path.resolve(__dirname, '../db/local/generated/schema-manifest.hash'),
  path.resolve(__dirname, '../../db/local/generated/schema-manifest.hash'),
  path.resolve(process.cwd(), 'src/db/local/generated/schema-manifest.hash'),
  path.resolve(process.cwd(), 'dist/db/local/generated/schema-manifest.hash'),
];

export function getSchemaManifestHash(): string | undefined {
  if (attemptedLoad) {
    return cachedHash;
  }
  attemptedLoad = true;
  for (const candidate of hashPaths) {
    try {
      const content = fs.readFileSync(candidate, 'utf8').trim();
      if (content) {
        cachedHash = content;
        break;
      }
    } catch {
      // Ignore missing files; manifest hash is optional when not using postgres manifest pipeline
    }
  }
  return cachedHash;
}
