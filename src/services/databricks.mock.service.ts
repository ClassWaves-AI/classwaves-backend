import { v4 as uuidv4 } from 'uuid';

type Row = Record<string, any>;

type FixtureHandler = (sql: string, params: any[]) => Row[] | Promise<Row[]>;

type FixtureEntry = {
  match: RegExp;
  handler: FixtureHandler;
};

/**
 * Lightweight in-memory Databricks mock used for tests and local development.
 *
 * The mock tracks table data and column metadata to satisfy simple CRUD flows
 * and migration scripts without reaching the real warehouse. Consumers can
 * register custom fixtures for specific queries when deterministic responses
 * are required.
 */
export class DatabricksMockService {
  private static fixtures: FixtureEntry[] = [];
  private static tables: Map<string, Row[]> = new Map();
  private static columns: Map<string, Set<string>> = new Map();
  private static auditLog: Row[] = [];

  /** Register a fixture that handles queries matching the provided pattern. */
  static registerFixture(match: RegExp, handler: FixtureHandler): void {
    this.fixtures.push({ match, handler });
  }

  /** Clear all fixtures and stored table data (useful between tests). */
  static reset(): void {
    this.fixtures = [];
    this.tables.clear();
    this.columns.clear();
    this.auditLog = [];
  }

  /** Seed a logical table with rows (overwrites existing data). */
  static seedTable(tableRef: string, rows: Row[]): void {
    this.tables.set(this.normalizeTable(tableRef), rows.map((row) => ({ ...row })));
  }

  /** Snapshot current audit entries captured via recordAuditLog. */
  static getAuditLog(): Row[] {
    return [...this.auditLog];
  }

  async connect(): Promise<void> {
    return;
  }

  async disconnect(): Promise<void> {
    return;
  }

  async healthProbe(): Promise<{ ok: boolean; breaker: { state: string; consecutiveFailures: number; since: number }; durations: { total: number } }> {
    return {
      ok: true,
      breaker: { state: 'CLOSED', consecutiveFailures: 0, since: Date.now() },
      durations: { total: 0 },
    };
  }

  getCircuitBreakerStatus(): { state: 'CLOSED'; consecutiveFailures: number; since: number } {
    return { state: 'CLOSED', consecutiveFailures: 0, since: Date.now() };
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    let finalSql = sql;
    if (params && params.length > 0) {
      const parts = sql.split('?');
      const expected = parts.length - 1;
      const used = Math.min(expected, params.length);
      let built = '';
      for (let i = 0; i < used; i++) {
        built += parts[i] + this.formatParam(params[i]);
      }
      built += parts.slice(used).join('?');
      finalSql = built;
    }

    const trimmed = finalSql.trim();

    const fixture = DatabricksMockService.fixtures.find((entry) => entry.match.test(trimmed));
    if (fixture) {
      const result = await fixture.handler(trimmed, params);
      return Array.isArray(result) ? (result as T[]) : [];
    }

    if (/^select\s+1\s+as\s+ping/i.test(trimmed)) {
      return [{ ping: 1 }] as unknown as T[];
    }

    if (/^create\s+table/i.test(trimmed)) {
      this.handleCreateTable(trimmed);
      return [];
    }

    if (/^alter\s+table/i.test(trimmed)) {
      this.handleAlterTable(trimmed);
      return [];
    }

    if (/^drop\s+table/i.test(trimmed)) {
      this.handleDropTable(trimmed);
      return [];
    }

    if (/^insert\s+into/i.test(trimmed)) {
      this.handleInsert(trimmed);
      return [];
    }

    if (/^delete\s+from/i.test(trimmed)) {
      this.handleDelete(trimmed);
      return [];
    }

    const tableRef = this.extractTableRef(trimmed);
    if (tableRef) {
      const table = DatabricksMockService.tables.get(tableRef);
      if (!table) {
        return [];
      }
      const filtered = this.applyBasicFilters(table, trimmed, params);
      return filtered as T[];
    }

    return [];
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  generateId(): string {
    return uuidv4();
  }

  toMapStringString(obj: Record<string, string | null | undefined>): { __rawSql: string } {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(obj || {})) {
      const safeKey = String(key).replace(/'/g, "''");
      const safeValue = value == null ? null : String(value).replace(/'/g, "''");
      parts.push(`'${safeKey}'`, safeValue == null ? 'CAST(NULL AS STRING)' : `'${safeValue}'`);
    }
    return { __rawSql: `map(${parts.join(', ')})` };
  }

  async insert(table: string, data: Row): Promise<void> {
    const ref = DatabricksMockService.normalizeTable(table);
    const rows = DatabricksMockService.tables.get(ref) ?? [];
    rows.push({ ...data });
    DatabricksMockService.tables.set(ref, rows);
    this.trackColumns(ref, data);
  }

  async batchInsert(table: string, rows: Row[]): Promise<void> {
    for (const row of rows) {
      await this.insert(table, row);
    }
  }

  async update(table: string, id: string, data: Row): Promise<boolean> {
    const ref = DatabricksMockService.normalizeTable(table);
    const rows = DatabricksMockService.tables.get(ref);
    if (!rows) return false;
    const index = rows.findIndex((row) => row.id === id || row.prompt_id === id);
    if (index === -1) return false;
    rows[index] = { ...rows[index], ...data };
    this.trackColumns(ref, data);
    return true;
  }

  async updateWhere(table: string, where: Row, data: Row): Promise<number> {
    const ref = DatabricksMockService.normalizeTable(table);
    const rows = DatabricksMockService.tables.get(ref);
    if (!rows) return 0;
    let updates = 0;
    for (let i = 0; i < rows.length; i++) {
      if (this.matchesWhere(rows[i], where)) {
        rows[i] = { ...rows[i], ...data };
        updates++;
      }
    }
    this.trackColumns(ref, data);
    return updates;
  }

  async upsert(table: string, whereCondition: Row, data: Row): Promise<void> {
    const updated = await this.updateWhere(table, whereCondition, data);
    if (updated === 0) {
      await this.insert(table, { ...whereCondition, ...data });
    }
  }

  async delete(table: string, id: string): Promise<boolean> {
    const ref = DatabricksMockService.normalizeTable(table);
    const rows = DatabricksMockService.tables.get(ref);
    if (!rows) return false;
    const initialLength = rows.length;
    DatabricksMockService.tables.set(ref, rows.filter((row) => row.id !== id && row.prompt_id !== id));
    return DatabricksMockService.tables.get(ref)!.length < initialLength;
  }

  async tableHasColumns(schema: string, table: string, columns: string[]): Promise<boolean> {
    const keys = [
      DatabricksMockService.normalizeTable(`${schema}.${table}`),
      DatabricksMockService.normalizeTable(`${databricksDefaultCatalog()}.${schema}.${table}`),
      DatabricksMockService.normalizeTable(table),
    ];

    for (const key of keys) {
      const set = DatabricksMockService.columns.get(key);
      if (set && columns.every((col) => set.has(col.toLowerCase()))) {
        return true;
      }
    }
    return false;
  }

  async getSchoolByDomain(domain: string): Promise<Row | null> {
    return this.findOneByField('schools', 'domain', domain);
  }

  async getTeacherByGoogleId(googleId: string): Promise<Row | null> {
    return this.findOneByField('teachers', 'google_id', googleId);
  }

  async getTeacherByEmail(email: string): Promise<Row | null> {
    return this.findOneByField('teachers', 'email', email);
  }

  async upsertTeacher(data: Partial<Row>): Promise<void> {
    const ref = DatabricksMockService.normalizeTable('teachers');
    const rows = DatabricksMockService.tables.get(ref) ?? [];
    const index = rows.findIndex((row) => row.id === data.id || row.email === data.email);
    if (index === -1) {
      rows.push({ id: data.id ?? this.generateId(), ...data });
    } else {
      rows[index] = { ...rows[index], ...data };
    }
    DatabricksMockService.tables.set(ref, rows);
    this.trackColumns(ref, data);
  }

  async getTeacherSessions(teacherId: string, limit = 10): Promise<Row[]> {
    const ref = DatabricksMockService.normalizeTable('sessions');
    const rows = DatabricksMockService.tables.get(ref) ?? [];
    return rows.filter((row) => row.teacher_id === teacherId).slice(0, limit).map((row) => ({ ...row }));
  }

  async createSession(data: Row): Promise<Row> {
    const session = { id: data.id ?? this.generateId(), ...data };
    await this.insert('sessions', session);
    return session;
  }

  async updateSessionStatus(sessionId: string, status: string, additionalData?: Row): Promise<boolean> {
    return this.update('sessions', sessionId, { status, ...(additionalData || {}) });
  }

  async recordAuditLog(entry: Row): Promise<void> {
    DatabricksMockService.auditLog.push({ ...entry });
  }

  async recordAuditLogBatch(entries: Row[]): Promise<void> {
    entries.forEach((entry) => DatabricksMockService.auditLog.push({ ...entry }));
  }

  async batchAuthOperations(googleUser?: any, domain?: string): Promise<{ school: any; teacher: any }> {
    const now = new Date();
    const email = (googleUser?.email || 'mock-teacher@classwaves.test').toLowerCase();
    const isRob = email === 'rob@classwaves.ai';
    const role: 'teacher' | 'admin' | 'super_admin' = isRob ? 'super_admin' : 'teacher';
    const schoolId = '11111111-1111-1111-1111-111111111111';
    const teacherId = isRob ? '00000000-0000-0000-0000-000000000001' : 'mock-teacher';

    return {
      school: {
        id: schoolId,
        name: 'Dev School',
        domain: domain || 'devschool.local',
        subscription_tier: 'trial',
        subscription_status: 'active',
        teacher_count: 1,
        student_count: 0,
      },
      teacher: {
        id: teacherId,
        google_id: googleUser?.id || 'mock-google-id',
        email,
        name: googleUser?.name || (isRob ? 'Dev Super Admin' : 'Mock Teacher'),
        picture: googleUser?.picture || '',
        school_id: schoolId,
        status: 'active',
        role,
        access_level: 'basic',
        max_concurrent_sessions: 3,
        current_sessions: 0,
        timezone: 'UTC',
        login_count: 1,
        total_sessions_created: 0,
        last_login: now,
        created_at: now,
        updated_at: now,
      },
    };
  }

  private static normalizeTable(table: string): string {
    return table.toLowerCase();
  }

  private extractTableRef(sql: string): string | null {
    const fromMatch = sql.match(/from\s+([a-z0-9_.]+)/i);
    if (fromMatch) {
      return DatabricksMockService.normalizeTable(fromMatch[1]);
    }
    const updateMatch = sql.match(/update\s+([a-z0-9_.]+)/i);
    if (updateMatch) {
      return DatabricksMockService.normalizeTable(updateMatch[1]);
    }
    const insertMatch = sql.match(/into\s+([a-z0-9_.]+)/i);
    if (insertMatch) {
      return DatabricksMockService.normalizeTable(insertMatch[1]);
    }
    return null;
  }

  private applyBasicFilters(rows: Row[], sql: string, params: any[]): Row[] {
    if (!/where\s+/i.test(sql)) {
      return rows.map((row) => ({ ...row }));
    }

    const whereMatch = sql.match(/where\s+([^;]+)/i);
    if (!whereMatch) {
      return rows.map((row) => ({ ...row }));
    }

    const conditions = whereMatch[1].split(/\band\b/i).map((part) => part.trim());

    return rows.filter((row) => {
      let paramIndex = 0;
      return conditions.every((condition) => {
        const eqMatch = condition.match(/([a-z0-9_\.]+)\s*=\s*\?/i);
        if (eqMatch) {
          const field = eqMatch[1].split('.').pop() as string;
          const expected = params[paramIndex++];
          return row[field] === expected;
        }
        return true;
      });
    }).map((row) => ({ ...row }));
  }

  private matchesWhere(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => row[key] === value);
  }

  private handleAlterTable(sql: string): void {
    const match = sql.match(/alter\s+table\s+([a-z0-9_\.]+)\s+add\s+columns\s*\((.+)\)/i);
    if (!match) {
      return;
    }
    const tableRef = DatabricksMockService.normalizeTable(match[1]);
    const columnsExpr = match[2];
    const columnRegex = /([a-z0-9_]+)\s+[a-z0-9_<>\[\]]+/gi;
    let colMatch: RegExpExecArray | null;
    const keyVariants = this.expandTableRefs(tableRef);
    while ((colMatch = columnRegex.exec(columnsExpr)) !== null) {
      for (const key of keyVariants) {
        const set = DatabricksMockService.columns.get(key) ?? new Set<string>();
        set.add(colMatch[1].toLowerCase());
        DatabricksMockService.columns.set(key, set);
      }
    }
  }

  private handleDropTable(sql: string): void {
    const match = sql.match(/drop\s+table\s+(if\s+exists\s+)?([a-z0-9_\.]+)/i);
    if (!match) {
      return;
    }
    const tableRef = DatabricksMockService.normalizeTable(match[2]);
    const variants = this.expandTableRefs(tableRef);
    for (const ref of variants) {
      DatabricksMockService.tables.delete(ref);
      DatabricksMockService.columns.delete(ref);
    }
  }

  private trackColumns(tableRef: string, data: Row | undefined): void {
    if (!data) return;
    const variants = this.expandTableRefs(tableRef);
    Object.keys(data).forEach((key) => {
      for (const ref of variants) {
        const set = DatabricksMockService.columns.get(ref) ?? new Set<string>();
        set.add(key.toLowerCase());
        DatabricksMockService.columns.set(ref, set);
      }
    });
  }

  private findOneByField(table: string, field: string, value: any): Row | null {
    const ref = DatabricksMockService.normalizeTable(table);
    const rows = DatabricksMockService.tables.get(ref) ?? [];
    const match = rows.find((row) => row[field] === value);
    return match ? { ...match } : null;
  }

  mapStringString(obj: Record<string, string | null | undefined>): { __rawSql: string } {
    return this.toMapStringString(obj);
  }

  private expandTableRefs(tableRef: string): string[] {
    const refs = new Set<string>();
    refs.add(tableRef);
    const segments = tableRef.split('.');
    if (segments.length >= 2) {
      refs.add(segments.slice(-2).join('.'));
    }
    if (segments.length >= 1) {
      refs.add(segments[segments.length - 1]);
    }
    return Array.from(refs);
  }

  private handleCreateTable(sql: string): void {
    const match = sql.match(/create\s+table\s+(if\s+not\s+exists\s+)?([a-z0-9_\.]+)\s*\(([^;]+)\)/i);
    if (!match) return;
    const tableRef = DatabricksMockService.normalizeTable(match[2]);
    const body = match[3];
    const columnRegex = /([a-z0-9_]+)\s+[a-z0-9_<>\[\]]+/gi;
    let colMatch: RegExpExecArray | null;
    const columnSet = new Set<string>();
    while ((colMatch = columnRegex.exec(body)) !== null) {
      columnSet.add(colMatch[1].toLowerCase());
    }
    const variants = this.expandTableRefs(tableRef);
    for (const ref of variants) {
      DatabricksMockService.tables.set(ref, DatabricksMockService.tables.get(ref) ?? []);
      const set = DatabricksMockService.columns.get(ref) ?? new Set<string>();
      columnSet.forEach((col) => set.add(col));
      DatabricksMockService.columns.set(ref, set);
    }
  }

  private handleInsert(sql: string): void {
    const match = sql.match(/insert\s+into\s+([a-z0-9_\.]+)\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)/i);
    if (!match) return;
    const tableRef = DatabricksMockService.normalizeTable(match[1]);
    const columns = match[2].split(',').map((col) => col.trim().replace(/[`"']/g, '').toLowerCase());
    const rawValues = match[3].split(',').map((value) => value.trim());
    const row: Row = {};
    columns.forEach((col, idx) => {
      const token = rawValues[idx] ?? 'NULL';
      row[col] = this.parseLiteral(token);
    });
    this.insert(tableRef, row);
  }

  private handleDelete(sql: string): void {
    const match = sql.match(/delete\s+from\s+([a-z0-9_\.]+)\s+where\s+([a-z0-9_\.]+)\s*=\s*('?[^\s;]+'?)/i);
    if (!match) return;
    const tableRef = DatabricksMockService.normalizeTable(match[1]);
    const column = match[2].split('.').pop() as string;
    let valueToken = match[3];
    if (valueToken.startsWith("'")) {
      valueToken = valueToken.slice(1, -1);
    }
    const value = valueToken === 'NULL' ? null : valueToken;
    const rows = DatabricksMockService.tables.get(tableRef);
    if (!rows) return;
    DatabricksMockService.tables.set(
      tableRef,
      rows.filter((row) => row[column] !== value)
    );
  }

  private parseLiteral(token: string): any {
    if (token === 'NULL') return null;
    if (/^current_timestamp/i.test(token)) return new Date().toISOString();
    if (token.startsWith("'")) return token.slice(1, -1).replace(/''/g, "'");
    const numeric = Number(token);
    if (!Number.isNaN(numeric)) return numeric;
    return token;
  }

  private formatParam(param: any): string {
    if (param === null || param === undefined) return 'NULL';
    if (param instanceof Date) return `'${param.toISOString()}'`;
    if (typeof param === 'string') return `'${param.replace(/'/g, "''")}'`;
    if (typeof param === 'boolean') return param ? 'true' : 'false';
    if (typeof param === 'number') return Number.isFinite(param) ? String(param) : 'NULL';
    if (typeof param === 'object') {
      try {
        const json = JSON.stringify(param);
        return json ? `'${json.replace(/'/g, "''")}'` : 'NULL';
      } catch {
        return `'${String(param).replace(/'/g, "''")}'`;
      }
    }
    return `'${String(param).replace(/'/g, "''")}'`;
  }
}

const databricksDefaultCatalog = (): string => process.env.DATABRICKS_CATALOG || 'classwaves';

export const databricksMockService = new DatabricksMockService();

export const databricksMock = {
  registerFixture: DatabricksMockService.registerFixture.bind(DatabricksMockService),
  reset: DatabricksMockService.reset.bind(DatabricksMockService),
  seedTable: DatabricksMockService.seedTable.bind(DatabricksMockService),
  getAuditLog: DatabricksMockService.getAuditLog.bind(DatabricksMockService),
};
