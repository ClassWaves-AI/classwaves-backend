export function normalizeTableFqn(fqn: string): { schema: string; table: string; identifier: string } {
  const trimmed = fqn.trim();
  const parts = trimmed.split('.');
  if (parts.length === 3 && parts[0] === 'classwaves') {
    const [, schema, table] = parts;
    return { schema, table, identifier: `${schema}.${table}` };
  }
  if (parts.length === 2) {
    const [schema, table] = parts;
    return { schema, table, identifier: `${schema}.${table}` };
  }
  throw new Error(`Invalid table FQN: ${fqn}. Expected schema.table or classwaves.schema.table.`);
}
