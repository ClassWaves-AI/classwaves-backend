import path from 'path';
import { buildSchemaManifest } from '../../../../../scripts/dbx-manifest/manifest';

describe('buildSchemaManifest', () => {
  const manifest = buildSchemaManifest(path.join('docs', 'DATABASE_SCHEMA_COMPLETE.md'), {
    sourcePath: path.resolve(__dirname, '../../../../../'),
  });

  it('captures all non-system schemas', () => {
    const schemaNames = manifest.schemas.map((schema) => schema.name).sort();
    expect(schemaNames).toEqual([
      'admin',
      'ai_insights',
      'analytics',
      'audio',
      'communication',
      'compliance',
      'notifications',
      'operational',
      'sessions',
      'users',
    ]);
  });

  it('parses tables and columns with mapped postgres types', () => {
    const totalTables = manifest.schemas.reduce((acc, schema) => acc + schema.tables.length, 0);
    expect(totalTables).toBeGreaterThanOrEqual(48);

    const sessionsSchema = manifest.schemas.find((schema) => schema.name === 'sessions');
    expect(sessionsSchema).toBeDefined();
    const classroomSessions = sessionsSchema?.tables.find((table) => table.name === 'classroom_sessions');
    expect(classroomSessions).toBeDefined();
    const idColumn = classroomSessions?.columns.find((column) => column.name === 'id');
    expect(idColumn?.postgresType).toBe('uuid');
  });

  it('records generated timestamp from the source document', () => {
    expect(manifest.generatedAt).toBe('2025-09-23T16:07:45.330Z');
  });
});
