// Environment variables are usually loaded by app.ts via dotenv.
// As a resilience fallback for CI/CLI environments that provide a `.ENVIRONMENT` file,
// attempt to read that file and populate missing Databricks variables.

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

function populateFromEnvironmentFile() {
  const keys = ['DATABRICKS_HOST', 'DATABRICKS_TOKEN', 'DATABRICKS_WAREHOUSE_ID', 'DATABRICKS_CATALOG'];
  const missing = keys.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length === 0) return;

  // Walk up from cwd to find a `.ENVIRONMENT` file
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.ENVIRONMENT');
    try {
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, 'utf8');
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
          const eq = trimmed.indexOf('=');
          if (eq <= 0) continue;
          const key = trimmed.slice(0, eq).trim();
          let val = trimmed.slice(eq + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('\'') && val.endsWith('\''))) {
            val = val.slice(1, -1);
          }
          if (keys.includes(key) && (!process.env[key] || String(process.env[key]).trim() === '')) {
            process.env[key] = val;
          }
        }
        break; // Stop after first found
      }
    } catch {
      // ignore and keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

function populateFromEnvDotFiles() {
  const needed = ['DATABRICKS_HOST', 'DATABRICKS_TOKEN', 'DATABRICKS_WAREHOUSE_ID', 'DATABRICKS_CATALOG'];
  const isMissing = (k: string) => !process.env[k] || String(process.env[k]).trim() === '';
  if (!needed.some(isMissing)) return;

  const candidates = [
    // when running from classwaves-backend
    path.resolve(process.cwd(), '.env'),
    // when imported from src/config
    path.resolve(__dirname, '../../.env'),
    // monorepo root fallback (rare)
    path.resolve(process.cwd(), 'classwaves-backend/.env'),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const parsed = dotenv.parse(fs.readFileSync(p));
        for (const key of needed) {
          if (parsed[key] && isMissing(key)) {
            process.env[key] = parsed[key];
          }
        }
        // stop after first successful load
        break;
      }
    } catch {
      // ignore and continue
    }
  }
}

populateFromEnvironmentFile();
populateFromEnvDotFiles();

export const databricksConfig = {
  host: process.env.DATABRICKS_HOST || '',
  token: process.env.DATABRICKS_TOKEN || '',
  warehouse: process.env.DATABRICKS_WAREHOUSE_ID || '',
  // Catalog default is 'classwaves' unless overridden
  catalog: process.env.DATABRICKS_CATALOG || 'classwaves',
  schema: 'users' // Default schema, but we'll use fully qualified names
};
