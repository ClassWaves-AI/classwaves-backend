import fs from 'fs';
import path from 'path';
import { produceManifestArtifacts, renderSchema } from '../../../../../scripts/dbx-manifest/generate';

describe('dbx manifest generator', () => {
  it('produces manifest, hash, and schema SQL consistently', () => {
    const { manifest, manifestHash, schemaSql } = produceManifestArtifacts();

    expect(manifest.schemas.length).toBe(10);
    expect(manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(schemaSql).toContain('CREATE SCHEMA IF NOT EXISTS admin;');
    expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS sessions.classroom_sessions');
    expect(schemaSql).toContain('PRIMARY KEY (id)');

    const persistedHashPath = path.resolve(__dirname, '../../../../../', 'src', 'db', 'local', 'generated', 'schema-manifest.hash');
    if (fs.existsSync(persistedHashPath)) {
      const persistedHash = fs.readFileSync(persistedHashPath, 'utf8').trim();
      expect(manifestHash).toBe(persistedHash);
    }
  });

  it('renders schema from an existing manifest snapshot', () => {
    const manifestPath = path.resolve(__dirname, '../../../../../', 'src', 'db', 'local', 'generated', 'schema-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const sql = renderSchema(manifest);
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS users;');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS users.teachers');
  });
});
