import { mapDbxTypeToPostgres } from '../../../../../scripts/dbx-manifest/mapping';

describe('mapDbxTypeToPostgres', () => {
  it('maps decimal to numeric with precision', () => {
    expect(mapDbxTypeToPostgres('confidence_score', 'decimal(5,4)')).toBe('numeric(5,4)');
  });

  it('maps timestamp to timestamptz', () => {
    expect(mapDbxTypeToPostgres('created_at', 'timestamp')).toBe('timestamptz');
  });

  it('maps JSON-like types to jsonb', () => {
    expect(mapDbxTypeToPostgres('payload', 'array<string>')).toBe('jsonb');
    expect(mapDbxTypeToPostgres('result_data', 'string')).toBe('jsonb');
    expect(mapDbxTypeToPostgres('contract_details', 'map<string,string>')).toBe('jsonb');
  });

  it('treats ID columns as uuid', () => {
    expect(mapDbxTypeToPostgres('id', 'string')).toBe('uuid');
    expect(mapDbxTypeToPostgres('teacher_id', 'string')).toBe('uuid');
    expect(mapDbxTypeToPostgres('session_uuid', 'string')).toBe('uuid');
  });

  it('defaults to text for other string columns', () => {
    expect(mapDbxTypeToPostgres('analysis_type', 'string')).toBe('text');
  });
});
