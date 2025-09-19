#!/usr/bin/env node
/*
  Compare canonical Databricks SOT (docs/DATABASE_SCHEMA_COMPLETE.md)
  with local Postgres export (docs/LOCAL_POSTGRES_SCHEMA.md) at a coarse level.
  Outputs table/column presence diffs to stdout.
*/
const fs = require('fs');
const path = require('path');

const dbxPath = path.join(__dirname, '..', 'docs', 'DATABASE_SCHEMA_COMPLETE.md');
const pgPath = path.join(__dirname, '..', 'docs', 'LOCAL_POSTGRES_SCHEMA.md');

function parseDbx(md) {
  const lines = md.split(/\r?\n/);
  const tables = new Map(); // key: schema.table -> Map(col -> {type, nullable})
  let currentTable = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(/^### Table: `([^`]+)`/);
    if (m) {
      currentTable = m[1];
      if (!tables.has(currentTable)) tables.set(currentTable, new Map());
      continue;
    }
    if (currentTable && l.startsWith('| `')) {
      // Expect: | `column` | `type` | ✅ | comment |
      const parts = l.split('|').map(s => s.trim());
      const colField = parts[1] || '';
      const typeField = parts[2] || '';
      const nullableField = parts[3] || '';
      if (!colField.startsWith('`')) continue;
      const name = colField.replace(/`/g, '');
      const type = typeField.replace(/`/g, '').toLowerCase();
      const nullable = nullableField.includes('✅');
      tables.get(currentTable).set(name, { type, nullable });
    }
  }
  return tables;
}

function parsePg(md) {
  const lines = md.split(/\r?\n/);
  const tables = new Map(); // table -> Map(col -> {type, nullable})
  for (const l of lines) {
    if (!l.startsWith('|')) continue;
    const parts = l.split('|').map(s => s.trim());
    if (parts[1] === 'Table' || parts.length < 5) continue; // header or invalid
    const table = parts[1];
    const col = parts[2];
    const type = (parts[3] || '').toLowerCase();
    const nullable = ((parts[4] || '').toUpperCase() === 'YES');
    if (!table || !col) continue;
    if (!tables.has(table)) tables.set(table, new Map());
    tables.get(table).set(col, { type, nullable });
  }
  return tables;
}

function main() {
  if (!fs.existsSync(dbxPath)) {
    console.error('Missing Databricks SOT at', dbxPath);
    process.exit(1);
  }
  if (!fs.existsSync(pgPath)) {
    console.error('Missing local Postgres schema at', pgPath);
    process.exit(1);
  }
  const dbx = parseDbx(fs.readFileSync(dbxPath, 'utf8'));
  const pg = parsePg(fs.readFileSync(pgPath, 'utf8'));

  // Normalize DBX table names to schema.table (drop catalog prefix if present)
  const normalize = (t) => {
    const parts = t.split('.');
    if (parts.length === 3) return parts.slice(1).join('.');
    return t;
  };

  const dbxNorm = new Map();
  for (const [t, cols] of dbx.entries()) {
    dbxNorm.set(normalize(t), cols);
  }

  const allTables = new Set([...dbxNorm.keys(), ...pg.keys()]);
  const missingInPg = [];
  const extraInPg = [];
  const columnDiffs = [];
  const typeNullMismatches = [];

  function canonicalType(dbxType, pgType, colName) {
    const d = (dbxType || '').toLowerCase();
    const p = (pgType || '').toLowerCase();
    // Normalize DBX → canonical
    let dCanon = d
      .replace(/decimal\([^\)]*\)/g, 'numeric')
      .replace(/double precision|double/g, 'double precision')
      .replace(/string/g, 'text')
      .replace(/timestamp/g, 'timestamptz')
      .replace(/int/g, 'integer');
    // Heuristic: array/struct/json → jsonb acceptable in Postgres
    if (d.includes('array') || d.includes('struct') || colName.includes('payload') || colName.includes('context_supporting_lines') || colName.includes('learning_objectives')) {
      dCanon = 'jsonb';
    }
    // Normalize PG → canonical
    const pCanon = p
      .replace(/timestamp with time zone|timestamptz/g, 'timestamptz')
      .replace(/character varying|varchar|text/g, 'text')
      .replace(/integer|int4/g, 'integer')
      .replace(/double precision|float8/g, 'double precision')
      .replace(/jsonb|json/g, 'jsonb')
      .replace(/numeric\([^\)]*\)|decimal\([^\)]*\)/g, 'numeric');
    return { dCanon, pCanon };
  }

  for (const t of allTables) {
    const d = dbxNorm.get(t);
    const p = pg.get(t);
    if (!d) { extraInPg.push(t); continue; }
    if (!p) { missingInPg.push(t); continue; }
    const dOnly = [...d.keys()].filter(c => !p.has(c));
    const pOnly = [...p.keys()].filter(c => !d.has(c));
    if (dOnly.length || pOnly.length) {
      columnDiffs.push({ table: t, dbxMissing: pOnly, pgMissing: dOnly });
    }
    // For common columns, check type/nullability compatibility
    const common = [...d.keys()].filter(c => p.has(c));
    for (const c of common) {
      const dMeta = d.get(c);
      const pMeta = p.get(c);
      const { dCanon, pCanon } = canonicalType(dMeta.type, pMeta.type, c);
      const typeMatch = dCanon === pCanon;
      const nullMatch = Boolean(dMeta.nullable) === Boolean(pMeta.nullable);
      if (!typeMatch || !nullMatch) {
        typeNullMismatches.push({ table: t, column: c, dbx: { type: dMeta.type, nullable: dMeta.nullable }, pg: { type: pMeta.type, nullable: pMeta.nullable }, normalized: { dbx: dCanon, pg: pCanon } });
      }
    }
  }

  console.log('=== Schema Drift Report ===');
  if (missingInPg.length) {
    console.log('\nTables missing in Postgres:');
    missingInPg.sort().forEach(t => console.log(' -', t));
  }
  if (extraInPg.length) {
    console.log('\nExtra tables in Postgres (not in DBX canonical):');
    extraInPg.sort().forEach(t => console.log(' -', t));
  }
  if (columnDiffs.length) {
    console.log('\nColumn differences:');
    for (const diff of columnDiffs) {
      console.log(` - ${diff.table}`);
      if (diff.pgMissing.length) console.log('    Missing in Postgres:', diff.pgMissing.join(', '));
      if (diff.dbxMissing.length) console.log('    Extra in Postgres:', diff.dbxMissing.join(', '));
    }
  }
  if (typeNullMismatches.length) {
    console.log('\nType/Nullability mismatches:');
    for (const m of typeNullMismatches) {
      console.log(` - ${m.table}.${m.column}: DBX(type=${m.dbx.type}, nullable=${m.dbx.nullable}) vs PG(type=${m.pg.type}, nullable=${m.pg.nullable}) [normalized: ${m.normalized.dbx} vs ${m.normalized.pg}]`);
    }
  }

  if (!missingInPg.length && !extraInPg.length && !columnDiffs.length && !typeNullMismatches.length) {
    console.log('No differences detected at table/column/type/nullability level.');
  }
}

main();
