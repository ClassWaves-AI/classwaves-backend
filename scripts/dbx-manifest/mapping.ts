import crypto from 'crypto';
import { ManifestColumn, SchemaManifest } from './types';

const JSON_COLUMN_HINTS = [
  'payload',
  'result_data',
  'features',
  'metadata',
  'details',
  'context_supporting_lines',
  'context_prior_topic',
  'context_current_topic',
  'context_transition_idea',
  'contract_details',
  'analytics_payload',
];

const UUID_COLUMN_SUFFIXES = ['_id', '_ids', '_uuid'];

const ISO_STRING_FIELDS = ['created_at', 'updated_at'];

export function mapDbxTypeToPostgres(columnName: string, dbxType: string): string {
  const normalizedType = dbxType.trim().toLowerCase();
  const name = columnName.toLowerCase();

  if (normalizedType.startsWith('decimal(')) {
    return normalizedType.replace('decimal', 'numeric');
  }
  if (normalizedType === 'double') {
    return 'double precision';
  }
  if (normalizedType === 'int') {
    return 'integer';
  }
  if (normalizedType === 'bigint') {
    return 'bigint';
  }
  if (normalizedType === 'boolean') {
    return 'boolean';
  }
  if (normalizedType === 'date') {
    return 'date';
  }
  if (normalizedType === 'timestamp') {
    return 'timestamptz';
  }
  if (
    normalizedType.startsWith('array<') ||
    normalizedType.startsWith('map<') ||
    normalizedType.includes('struct<') ||
    JSON_COLUMN_HINTS.some((hint) => name.includes(hint))
  ) {
    return 'jsonb';
  }
  if (normalizedType === 'string') {
    if (isUuidLikeColumn(name)) {
      return 'uuid';
    }
    return 'text';
  }
  return 'text';
}

function isUuidLikeColumn(columnName: string): boolean {
  const lower = columnName.toLowerCase();
  if (lower === 'id') {
    return true;
  }
  if (UUID_COLUMN_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return true;
  }
  return false;
}

export function buildManifestHash(manifest: SchemaManifest): string {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(manifest));
  return hash.digest('hex');
}

export function sortColumns(columns: ManifestColumn[]): ManifestColumn[] {
  const priority = new Map<string, number>();
  let rank = 0;
  for (const key of ['id', 'session_id', 'teacher_id', 'school_id', 'created_at', 'updated_at']) {
    priority.set(key, rank++);
  }
  return [...columns].sort((a, b) => {
    const aRank = priority.has(a.name) ? priority.get(a.name)! : rank;
    const bRank = priority.has(b.name) ? priority.get(b.name)! : rank;
    if (aRank !== bRank) {
      return aRank - bRank;
    }
    return a.name.localeCompare(b.name);
  });
}

export function normalizeColumn(column: ManifestColumn): ManifestColumn {
  let postgresType = column.postgresType;

  // Ensure timestamp-like names prefer timestamptz when input ambiguous
  if (postgresType === 'text') {
    if (ISO_STRING_FIELDS.includes(column.name)) {
      postgresType = 'timestamptz';
    }
  }

  return {
    ...column,
    postgresType,
  };
}
