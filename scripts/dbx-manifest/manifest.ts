import fs from 'fs';
import path from 'path';
import { mapDbxTypeToPostgres, normalizeColumn, sortColumns } from './mapping';
import { ManifestColumn, ManifestTable, SchemaManifest } from './types';

const IGNORED_SCHEMAS = new Set(['information_schema']);

interface ParseOptions {
  sourcePath?: string;
}

export function buildSchemaManifest(docRelativePath: string, options: ParseOptions = {}): SchemaManifest {
  const resolvedPath = path.resolve(options.sourcePath ?? process.cwd(), docRelativePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Schema document not found at ${resolvedPath}`);
  }
  const content = fs.readFileSync(resolvedPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const generatedMatch = content.match(/\*\*Generated:\*\*\s*([^\n]+)/);
  const generatedAt = generatedMatch ? generatedMatch[1].trim() : new Date().toISOString();

  const schemas: SchemaManifest['schemas'] = [];
  let currentSchema: SchemaManifest['schemas'][number] | null = null;
  let currentTable: ManifestTable | null = null;
  let parsingColumns = false;

  const pushCurrentTable = () => {
    if (!currentSchema || !currentTable) {
      return;
    }
    currentTable.columns = sortColumns(currentTable.columns.map(normalizeColumn));
    currentSchema.tables.push(currentTable);
    currentTable = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      parsingColumns = false;
      continue;
    }

    const schemaMatch = line.match(/^## Schema: `([^`]+)`/);
    if (schemaMatch) {
      pushCurrentTable();
      const schemaName = schemaMatch[1];
      if (IGNORED_SCHEMAS.has(schemaName)) {
        currentSchema = null;
        continue;
      }
      currentSchema = { name: schemaName, tables: [] };
      schemas.push(currentSchema);
      continue;
    }

    const tableMatch = line.match(/^### Table: `([^`]+)`/);
    if (tableMatch) {
      pushCurrentTable();
      if (!currentSchema) {
        continue;
      }
      currentTable = {
        schema: currentSchema.name,
        name: tableMatch[1],
        columns: [],
      };
      parsingColumns = false;
      continue;
    }

    if (!currentTable) {
      continue;
    }

    const fullNameMatch = line.match(/^\*\*Full Name:\*\* `([^`]+)`/);
    if (fullNameMatch) {
      currentTable.fullName = fullNameMatch[1];
      const parts = fullNameMatch[1].split('.');
      if (parts.length >= 2) {
        const schemaName = parts[parts.length - 2];
        if (!IGNORED_SCHEMAS.has(schemaName)) {
          currentTable.schema = schemaName;
        }
      }
      continue;
    }

    if (line.startsWith('| Column |')) {
      parsingColumns = true;
      continue;
    }

    if (!parsingColumns) {
      continue;
    }

    if (line.startsWith('|--------')) {
      continue;
    }

    if (!line.startsWith('|')) {
      parsingColumns = false;
      continue;
    }

    const parts = line.split('|').map((segment) => segment.trim());
    if (parts.length < 5) {
      continue;
    }

    const columnName = stripTicks(parts[1]);
    const originalType = stripTicks(parts[2]);
    const nullableRaw = parts[3] ?? '';
    const commentRaw = parts[4] ?? '';
    if (!columnName) {
      continue;
    }

    const column: ManifestColumn = {
      name: columnName,
      originalType,
      postgresType: mapDbxTypeToPostgres(columnName, originalType),
      nullable: nullableRaw.includes('✅'),
    };
    const comment = stripTicks(commentRaw);
    if (comment) {
      column.comment = comment;
    }

    const existingIndex = currentTable.columns.findIndex((existing) => existing.name === column.name);
    if (existingIndex >= 0) {
      const existing = currentTable.columns[existingIndex];
      currentTable.columns[existingIndex] = {
        ...existing,
        postgresType: existing.postgresType || column.postgresType,
        originalType: existing.originalType || column.originalType,
        nullable: existing.nullable && column.nullable,
        comment: existing.comment || column.comment,
      };
    } else {
      currentTable.columns.push(column);
    }
  }

  pushCurrentTable();

  return {
    schemas,
    sourceDocument: path.relative(process.cwd(), resolvedPath),
    generatedAt,
  };
}

function stripTicks(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
