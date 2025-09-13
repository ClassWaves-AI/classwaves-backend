import { DBSQLClient } from '@databricks/sql';
import * as client from 'prom-client';
import { v4 as uuidv4 } from 'uuid';
import { databricksConfig } from '../config/databricks.config';

interface TranscriptionResult {
  text: string;
  confidence: number;
  language?: string;
  duration?: number;
}

interface TranscriptionWithMetrics extends TranscriptionResult {
  processingTime: number;
  timestamp: string;
}

interface QueryResult {
  rows: any[];
  metadata: any;
}

interface School {
  id: string;
  name: string;
  domain: string;
  google_workspace_id?: string;
  admin_email: string;
  subscription_tier: 'basic' | 'pro' | 'enterprise';
  subscription_status: 'active' | 'trial' | 'expired' | 'suspended';
  max_teachers: number;
  current_teachers: number;
  student_count: number;
  teacher_count: number;
  stripe_customer_id?: string;
  subscription_start_date?: Date;
  subscription_end_date: Date;
  trial_ends_at?: Date;
  ferpa_agreement: boolean;
  coppa_compliant: boolean;
  data_retention_days: number;
  created_at: Date;
  updated_at: Date;
}

interface Teacher {
  id: string;
  google_id: string;
  email: string;
  name: string;
  picture?: string;
  school_id: string;
  role: 'teacher' | 'admin' | 'super_admin';
  status: 'pending' | 'active' | 'suspended' | 'deactivated';
  access_level: string;
  max_concurrent_sessions: number;
  current_sessions: number;
  grade?: string;
  subject?: string;
  timezone: string;
  features_enabled?: string;
  last_login?: Date;
  login_count: number;
  total_sessions_created: number;
  created_at: Date;
  updated_at: Date;
  school_name?: string;
  school_domain?: string;
}

interface Session {
  id: string;
  title: string;
  description?: string;
  status: SessionStatus;
  scheduled_start?: Date;
  actual_start?: Date;
  actual_end?: Date;
  planned_duration_minutes: number;
  actual_duration_minutes?: number;
  target_group_size: number;
  auto_group_enabled: boolean;
  teacher_id: string;
  school_id: string;
  recording_enabled: boolean;
  transcription_enabled: boolean;
  ai_analysis_enabled: boolean;
  ferpa_compliant: boolean;
  coppa_compliant: boolean;
  recording_consent_obtained: boolean;
  data_retention_date?: Date;
  total_groups: number;
  total_students: number;
  participation_rate: number;
  engagement_score: number;
  created_at: Date;
  updated_at: Date;
  group_count?: number;
  student_count?: number;
}

type SessionStatus = 'created' | 'active' | 'paused' | 'ended' | 'archived';

interface CreateSessionData {
  title: string;
  description?: string;
  teacherId: string;
  schoolId: string;
  maxStudents?: number;
  targetGroupSize?: number;
  autoGroupEnabled?: boolean;
  scheduledStart?: Date;
  plannedDuration?: number;
}

interface TranscriptionData {
  sessionId: string;
  groupId?: string;
  speakerId: string;
  speakerName: string;
  text: string;
  timestamp: Date;
  duration: number;
  confidence: number;
}

export class DatabricksService {
  private client: DBSQLClient;
  private connection: any = null;
  private columnCache: Map<string, Set<string>> = new Map();
  private currentSession: any = null;
  private sessionPromise: Promise<any> | null = null;
  // Circuit breaker state
  private breakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private consecutiveFailures = 0;
  private requestCount = 0;
  private lastFailureAt = 0;
  private stateChangedAt = Date.now();
  private connectionParams: {
    hostname: string;
    path: string;
    token: string;
  };
  // Removed: Databricks waveWhispererUrl (STT migrated to OpenAI Whisper)

  constructor() {
    console.log('Databricks config:', {
      host: databricksConfig.host ? 'Set' : 'Missing',
      token: databricksConfig.token ? 'Set' : 'Missing',
      warehouse: databricksConfig.warehouse ? 'Set' : 'Missing',
      catalog: databricksConfig.catalog,
      schema: databricksConfig.schema,
    });
    
    if (!databricksConfig.host || !databricksConfig.token || !databricksConfig.warehouse) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('⚠️ Databricks configuration is incomplete. Proceeding in dev mode without DB connection.');
      } else {
        throw new Error('Databricks configuration is incomplete');
      }
    }

    // Parse the warehouse path from the environment variable
    const warehousePath = `/sql/1.0/warehouses/${databricksConfig.warehouse}`;
    
    this.connectionParams = {
      hostname: databricksConfig.host.replace(/^https?:\/\//, ''),
      path: warehousePath,
      token: databricksConfig.token || '',
    };

    this.client = new DBSQLClient();

    // STT via Databricks has been removed. Other Databricks services remain intact.
  }

  // ----------------------------
  // Metrics (lazy registration)
  // ----------------------------
  private dbQueryAttempts = (() => {
    const name = 'db_query_attempts_total';
    const existing = client.register.getSingleMetric(name) as client.Counter<string> | undefined;
    if (existing) return existing;
    return new client.Counter({ name, help: 'Total DB query attempts', labelNames: ['operation'] });
  })();

  private dbQueryRetries = (() => {
    const name = 'db_query_retries_total';
    const existing = client.register.getSingleMetric(name) as client.Counter<string> | undefined;
    if (existing) return existing;
    return new client.Counter({ name, help: 'Total DB query retries', labelNames: ['reason'] });
  })();

  private dbQueryFailures = (() => {
    const name = 'db_query_failures_total';
    const existing = client.register.getSingleMetric(name) as client.Counter<string> | undefined;
    if (existing) return existing;
    return new client.Counter({ name, help: 'Total DB query failures', labelNames: ['code'] });
  })();

  private dbQueryLatency = (() => {
    const name = 'db_query_latency_ms';
    const existing = client.register.getSingleMetric(name) as client.Histogram<string> | undefined;
    if (existing) return existing;
    return new client.Histogram({
      name,
      help: 'DB query latency in ms',
      buckets: [25, 50, 100, 200, 400, 800, 1600, 3200, 6400],
    });
  })();

  private dbBreakerGauge = (() => {
    const name = 'db_circuit_breaker_state';
    const existing = client.register.getSingleMetric(name) as client.Gauge<string> | undefined;
    if (existing) return existing;
    return new client.Gauge({ name, help: 'DB circuit breaker state (0=CLOSED,1=HALF_OPEN,2=OPEN)' });
  })();

  private setBreakerGauge(): void {
    const map: Record<typeof this.breakerState, number> = { CLOSED: 0, HALF_OPEN: 1, OPEN: 2 } as const;
    try { this.dbBreakerGauge.set(map[this.breakerState]); } catch {}
  }

  // ----------------------------
  // Error classification
  // ----------------------------
  private classifyError(err: any): 'TIMEOUT' | 'AUTH' | 'NETWORK' | 'THROTTLE' | 'INTERNAL' {
    const msg = String((err && (err.message || err.code)) || err || '').toLowerCase();
    if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('operation timeout')) return 'TIMEOUT';
    if (msg.includes('unauth') || msg.includes('401') || msg.includes('403') || msg.includes('invalid token')) return 'AUTH';
    if (
      msg.includes('enotfound') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('eai_again') ||
      msg.includes('getaddrinfo') ||
      msg.includes('network') ||
      msg.includes('socket hang up')
    ) return 'NETWORK';
    if (msg.includes('throttle') || msg.includes('rate') || msg.includes('429') || msg.includes('too many')) return 'THROTTLE';
    return 'INTERNAL';
  }

  // Exportable for tests
  public static classifyDatabricksError(err: any) {
    return new DatabricksService().classifyError(err);
  }

  // ----------------------------
  // Circuit breaker helpers
  // ----------------------------
  private now() { return Date.now(); }

  private breakerCanPass(): boolean {
    if (this.breakerState === 'OPEN') {
      const elapsed = this.now() - this.stateChangedAt;
      if (elapsed >= databricksConfig.breakerResetTimeoutMs) {
        this.transitionBreaker('HALF_OPEN', 'reset timeout elapsed');
        return true;
      }
      return false;
    }
    return true;
  }

  private transitionBreaker(next: 'CLOSED' | 'OPEN' | 'HALF_OPEN', reason: string): void {
    if (this.breakerState === next) return;
    const prev = this.breakerState;
    this.breakerState = next;
    this.stateChangedAt = this.now();
    this.setBreakerGauge();
    console.log(`🔄 DB Circuit Breaker ${prev} → ${next} (${reason})`);
    if (next === 'CLOSED') {
      this.consecutiveFailures = 0;
      this.requestCount = 0;
    }
  }

  private recordFailureAndMaybeOpen(code: string) {
    this.consecutiveFailures++;
    this.lastFailureAt = this.now();
    this.dbQueryFailures.inc({ code });
    const minReq = databricksConfig.breakerMinimumRequests;
    const threshold = databricksConfig.breakerFailureThreshold;
    if (this.requestCount >= minReq && this.consecutiveFailures >= threshold) {
      this.transitionBreaker('OPEN', `failures=${this.consecutiveFailures} (>=${threshold})`);
    }
  }

  public getCircuitBreakerStatus(): { state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; consecutiveFailures: number; since: number } {
    return { state: this.breakerState, consecutiveFailures: this.consecutiveFailures, since: this.stateChangedAt };
  }

  /**
   * Build a raw SQL expression for MAP<STRING, STRING>
   * Example output: map('k1','v1','k2',CAST(NULL AS STRING))
   */
  toMapStringString(obj: Record<string, string | null | undefined>): { __rawSql: string } {
    const esc = (s: string) => s.replace(/'/g, "''");
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj || {})) {
      if (k == null) continue;
      const keySql = `'${esc(String(k))}'`;
      const valSql = v == null ? 'CAST(NULL AS STRING)' : `'${esc(String(v))}'`;
      parts.push(keySql, valSql);
    }
    const mapExpr = parts.length > 0 ? `map(${parts.join(', ')})` : 'map()';
    return { __rawSql: mapExpr };
  }

  /**
   * Get column names for a table (cached, lowercase)
   */
  private async getTableColumns(schema: string, table: string): Promise<Set<string>> {
    const key = `${databricksConfig.catalog}.${schema}.${table}`.toLowerCase();
    const cached = this.columnCache.get(key);
    if (cached) return cached;
    try {
      const rows = await this.query<{ column_name: string }>(
        `SELECT lower(column_name) AS column_name
         FROM ${databricksConfig.catalog}.information_schema.columns
         WHERE table_schema = ? AND table_name = ?`,
        [schema, table]
      );
      const cols = new Set<string>(rows.map(r => r.column_name));
      this.columnCache.set(key, cols);
      return cols;
    } catch (e) {
      // If information_schema is unavailable, return empty (caller decides)
      return new Set();
    }
  }

  /**
   * Check if a table has all required columns
   */
  async tableHasColumns(schema: string, table: string, columns: string[]): Promise<boolean> {
    const cols = await this.getTableColumns(schema, table);
    if (cols.size === 0) return false;
    return columns.every(c => cols.has(c.toLowerCase()));
  }

  /**
   * Initialize connection to Databricks
   */
  async connect(): Promise<void> {
    try {
      console.log('Connection params:', {
        host: this.connectionParams.hostname,
        path: this.connectionParams.path,
        tokenLength: (this.connectionParams.token ? this.connectionParams.token.length : 0),
      });
      
      // Reset session state per connection
      this.currentSession = null;
      this.sessionPromise = null;

      const connectionOptions = {
        host: this.connectionParams.hostname,
        path: this.connectionParams.path,
        token: this.connectionParams.token,
      };
      
      if (!databricksConfig.token) {
        console.warn('⚠️ Skipping Databricks connection in dev mode (no token)');
        return;
      }
      // Enforce connect timeout
      this.connection = await Promise.race([
        (this.client as any).connect({
          ...connectionOptions,
          authType: 'access-token',
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Connect timeout after ${databricksConfig.connectTimeoutMs}ms`)), databricksConfig.connectTimeoutMs))
      ]);
      console.log('✅ Connected to Databricks SQL Warehouse');
    } catch (error) {
      console.error('❌ Failed to connect to Databricks:', error);
      throw error;
    }
  }

  /**
   * Close connection
   */
  async disconnect(): Promise<void> {
    if (this.currentSession) {
      try {
        await this.currentSession.close();
      } catch (error) {
        console.warn('Error closing session:', error);
      }
      this.currentSession = null;
    }
    this.sessionPromise = null;
    await this.client.close();
  }

  /**
   * Get or create a reusable session
   */
  private async getSession(): Promise<any> {
    // If we already have a session, return it
    if (this.currentSession) {
      return this.currentSession;
    }

    // If a session is being created, wait for it
    if (this.sessionPromise) {
      return await this.sessionPromise;
    }

    // Ensure connection exists
    if (!this.connection) {
      await this.connect();
    }

    // Create a new session via connection
    this.sessionPromise = (this.connection as any).openSession();
    
    try {
      this.currentSession = await this.sessionPromise;
      this.sessionPromise = null;
      return this.currentSession;
    } catch (error) {
      this.sessionPromise = null;
      throw error;
    }
  }

  /**
   * Reset session on error
   */
  private async resetSession(): Promise<void> {
    if (this.currentSession) {
      try {
        await this.currentSession.close();
      } catch (error) {
        // Ignore close errors
      }
    }
    this.currentSession = null;
    this.sessionPromise = null;
  }

  /**
   * Execute a query using reusable session with detailed timing
   */
  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const queryStart = performance.now();
    const queryPreview = sql.replace(/\s+/g, ' ').substring(0, 80) + '...';
    console.log(`🔍 DB QUERY START: ${queryPreview}`);
    
    let retries = 0;
    const maxRetries = Math.max(0, databricksConfig.maxRetries);
    this.requestCount++;

    while (retries <= maxRetries) {
      try {
        const sessionStart = performance.now();
        const session = await this.getSession();
        console.log(`⏱️  Session acquisition took ${(performance.now() - sessionStart).toFixed(2)}ms`);
        
        // Build query with parameters
        const paramStart = performance.now();
        let finalSql = sql;
        if (params && params.length > 0) {
          // Simple parameter replacement for ? placeholders
          params.forEach((param) => {
            let formattedParam: string;
            
            if (param === null || param === undefined) {
              formattedParam = 'NULL';
            } else if (typeof param === 'string') {
              // Escape single quotes in strings
              formattedParam = `'${param.replace(/'/g, "''")}'`;
            } else if (param instanceof Date) {
              // Format dates as ISO strings for Databricks
              formattedParam = `'${param.toISOString()}'`;
            } else if (typeof param === 'boolean') {
              formattedParam = param ? 'true' : 'false';
            } else if (typeof param === 'number') {
              formattedParam = param.toString();
            } else {
              // For other types, convert to string
              formattedParam = `'${String(param)}'`;
            }
            
            finalSql = finalSql.replace('?', formattedParam);
          });
        }
        console.log(`⏱️  Parameter formatting took ${(performance.now() - paramStart).toFixed(2)}ms`);
        
        const executeStart = performance.now();
        if (!this.breakerCanPass()) {
          throw new Error('DB_CIRCUIT_OPEN');
        }
        let operation: any;
        try {
          const execPromise = (async () => session.executeStatement(finalSql, {}))();
          operation = await Promise.race([
            execPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`QUERY_TIMEOUT:${databricksConfig.queryTimeoutMs}`)), databricksConfig.queryTimeoutMs))
          ]);
        } catch (e) {
          // Ensure operation is closed if created (defensive)
          if (operation && operation.close) {
            try { await operation.close(); } catch {}
          }
          throw e;
        }
        console.log(`⏱️  Statement execution took ${(performance.now() - executeStart).toFixed(2)}ms`);
        
        const fetchStart = performance.now();
        const fetchPromise = (async () => operation.fetchAll())();
        const fetchResult: any = await Promise.race([
          fetchPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error(`QUERY_TIMEOUT:${databricksConfig.queryTimeoutMs}`)), databricksConfig.queryTimeoutMs))
        ]);
        console.log(`⏱️  Result fetching took ${(performance.now() - fetchStart).toFixed(2)}ms`);
        
        await operation.close();
        
        const queryTotal = performance.now() - queryStart;
        try { this.dbQueryLatency.observe(queryTotal); } catch {}
        console.log(`🔍 DB QUERY COMPLETE - Total time: ${queryTotal.toFixed(2)}ms`);
        if (this.breakerState === 'HALF_OPEN') this.transitionBreaker('CLOSED', 'successful probe in half-open');
        this.consecutiveFailures = 0;
        
        // Normalize result shape from DBSQLClient
        // In our environment, fetchAll() returns an array of row objects.
        // Older versions or different drivers may return { rows: [...] }.
        let rows: any[] = [];
        if (Array.isArray(fetchResult)) {
          rows = fetchResult;
        } else if (fetchResult && Array.isArray(fetchResult.rows)) {
          rows = fetchResult.rows;
        } else if (fetchResult && Array.isArray(fetchResult.data_array)) {
          // Fallback: convert array of arrays to array of objects using metadata/columns if available
          const columns = (fetchResult.schema?.columns || []).map((c: any) => c.name);
          rows = fetchResult.data_array.map((arr: any[]) => {
            const obj: Record<string, any> = {};
            arr.forEach((val: any, idx: number) => {
              const key = columns[idx] || String(idx);
              obj[key] = val;
            });
            return obj;
          });
        }
        
        return rows;
      } catch (error) {
        const code = this.classifyError(error);
        console.error(`Query error (attempt ${retries + 1}) [${code}]:`, error);
        this.recordFailureAndMaybeOpen(code);
        // Reset session on error and maybe retry
        await this.resetSession();
        
        if (retries >= maxRetries) {
          throw error;
        }
        
        // Transient errors are retriable; non-transient (AUTH/INTERNAL) are not
        const retriable = code === 'TIMEOUT' || code === 'NETWORK' || code === 'THROTTLE';
        if (!retriable) {
          throw error;
        }
        retries++;
        this.dbQueryRetries.inc({ reason: code });
        // Exponential backoff with jitter
        const base = databricksConfig.backoffBaseMs;
        const max = databricksConfig.backoffMaxMs;
        const jitterRatio = Math.max(0, Math.min(1, databricksConfig.jitterRatio));
        const delay = Math.min(max, base * Math.pow(2, retries - 1));
        const jitter = delay * jitterRatio * (Math.random() - 0.5) * 2; // +/- jitterRatio
        const sleep = Math.max(0, Math.round(delay + jitter));
        await new Promise((r) => setTimeout(r, sleep));
      }
    }
    
    throw new Error('Query failed after all retries');
  }

  /**
   * Execute a query and return a single result
   */
  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const results = await this.query<T>(sql, params);
    return results[0] || null;
  }

  /**
   * Generate a unique ID
   */
  generateId(): string {
    return uuidv4();
  }

  /**
   * Get the appropriate schema for a table
   */
  private getSchemaForTable(table: string): string {
    // Map tables to their schemas - UPDATED FROM LIVE DATABASE AUDIT
    const tableSchemaMap: Record<string, string> = {
      // Admin schema
      'districts': 'admin',
      'school_settings': 'admin',

      // AI Insights schema
      'analysis_results': 'ai_insights',
      'educational_insights': 'ai_insights',
      'intervention_suggestions': 'ai_insights',
      'teacher_guidance_metrics': 'ai_insights',
      'teacher_prompt_effectiveness': 'ai_insights',
      'group_summaries': 'ai_insights',
      'session_summaries': 'ai_insights',
      'guidance_events': 'ai_insights',

      // Analytics schema
      'educational_metrics': 'analytics',
      'group_analytics': 'analytics',
      'group_metrics': 'analytics',
      'session_analytics': 'analytics',
      'session_events': 'analytics',
      'session_metrics': 'analytics',
      'student_metrics': 'analytics',

      // Audio schema
      'recordings': 'audio',

      // Communication schema
      'messages': 'communication',

      // Compliance schema
      'audit_log': 'compliance',
      'audit_logs': 'compliance', // Alias for audit_log
      'coppa_compliance': 'compliance',
      'parental_consents': 'compliance',
      'parental_consent_records': 'compliance', // Alias
      'retention_policies': 'compliance',

      // Notifications schema
      'notification_queue': 'notifications',
      'templates': 'notifications',

      // Operational schema
      'api_metrics': 'operational',
      'background_jobs': 'operational',
      'system_events': 'operational',

      // Sessions schema
      'classroom_sessions': 'sessions',
      'sessions': 'sessions', // Alias (deprecated - use classroom_sessions)
      'participants': 'sessions',
      'student_group_members': 'sessions',
      'student_groups': 'sessions',
      'groups': 'sessions', // Alias for student_groups
      'transcriptions': 'sessions',

      // Users schema
      'analytics_job_metadata': 'users',
      'dashboard_metrics_hourly': 'users', // Primary location for this table
      'schools': 'users',
      'session_analytics_cache': 'users', // Primary location for this table
      'students': 'users',
      'teacher_analytics_summary': 'users', // Primary location for this table
      'teachers': 'users'
    };
    
    return tableSchemaMap[table] || 'users'; // Default to users schema
  }

  /**
   * Parse an incoming table reference which may optionally include a schema prefix.
   * - Accepts: 'table' or 'schema.table'.
   * - Returns resolved { schema, table } using map defaults when schema not provided.
   */
  private parseTable(tableRef: string): { schema: string; table: string } {
    if (tableRef.includes('.')) {
      const parts = tableRef.split('.');
      if (parts.length >= 2) {
        const schema = parts[0].trim();
        const table = parts[1].trim();
        if (schema && table) return { schema, table };
      }
    }
    return { schema: this.getSchemaForTable(tableRef), table: tableRef };
  }

  /**
   * Insert a record
   */
  async insert(table: string, data: Record<string, any>): Promise<string> {
    const columns = Object.keys(data);
    // Support raw SQL values for advanced types (e.g., MAP<STRING, STRING>)
    const isRawSql = (v: any): v is { __rawSql: string } => !!v && typeof v === 'object' && typeof v.__rawSql === 'string';
    const placeholdersArr: string[] = [];
    const params: any[] = [];
    for (const col of columns) {
      const val = (data as any)[col];
      if (isRawSql(val)) {
        placeholdersArr.push(val.__rawSql);
      } else {
        placeholdersArr.push('?');
        params.push(val);
      }
    }
    const placeholders = placeholdersArr.join(', ');
    
    // Determine the schema based on the table name
    const { schema, table: tbl } = this.parseTable(table);
    const sql = `
      INSERT INTO ${databricksConfig.catalog}.${schema}.${tbl} (${columns.join(', ')})
      VALUES (${placeholders})
    `;
    
    // DEBUG: Log the exact SQL and table info for session creation issues
    if (table === 'classroom_sessions' || table === 'student_groups' || table === 'student_group_members') {
      console.log(`🔍 DEBUG ${table.toUpperCase()} INSERT:`);
      console.log(`  Table: ${tbl}`);
      console.log(`  Schema: ${schema}`);
      console.log(`  Full table path: ${databricksConfig.catalog}.${schema}.${tbl}`);
      console.log(`  Columns (${columns.length}): ${columns.join(', ')}`);
      console.log(`  SQL: ${sql.trim()}`);
      console.log(`  Data types:`, Object.entries(data).map(([k,v]) => `${k}:${typeof v}`).join(', '));
    }
    
    try {
      await this.query(sql, params);
      if (table === 'classroom_sessions' || table === 'student_groups' || table === 'student_group_members') {
        console.log(`✅ ${table.toUpperCase()} INSERT SUCCESS`);
      }
      return data.id || this.generateId();
    } catch (insertError) {
      console.error(`❌ ${table.toUpperCase()} INSERT FAILED:`, {
        table: tbl,
        schema,
        fullPath: `${databricksConfig.catalog}.${schema}.${tbl}`,
        error: insertError,
        columns: columns.join(', '),
        errorMessage: insertError instanceof Error ? insertError.message : String(insertError)
      });
      throw insertError;
    }
  }

  /**
   * Batch insert rows into a table using single INSERT ... VALUES (...), (...)
   */
  async batchInsert(table: string, rows: Record<string, any>[]): Promise<void> {
    if (!rows || rows.length === 0) return;
    const { schema, table: tbl } = this.parseTable(table);
    const columns = Object.keys(rows[0]);
    // Ensure all rows have same columns
    for (const r of rows) {
      const keys = Object.keys(r);
      if (keys.length !== columns.length || !columns.every((c) => keys.includes(c))) {
        throw new Error('Inconsistent row columns for batchInsert');
      }
    }
    const placeholdersRow = `(${columns.map(() => '?').join(', ')})`;
    const valuesPlaceholders = new Array(rows.length).fill(placeholdersRow).join(', ');
    const sql = `
      INSERT INTO ${databricksConfig.catalog}.${schema}.${tbl} (${columns.join(', ')})
      VALUES ${valuesPlaceholders}
    `;
    const params: any[] = [];
    for (const r of rows) {
      for (const c of columns) params.push(r[c]);
    }
    await this.query(sql, params);
  }

  /**
   * Update a record
   */
  async update(table: string, id: string, data: Record<string, any>): Promise<void> {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const setClause = columns.map(col => `${col} = ?`).join(', ');
    
    const { schema, table: tbl } = this.parseTable(table);
    const sql = `
      UPDATE ${databricksConfig.catalog}.${schema}.${tbl}
      SET ${setClause}
      WHERE id = ?
    `;
    
    await this.query(sql, [...values, id]);
  }

  /**
   * Update records by simple equality WHERE clause
   */
  async updateWhere(table: string, where: Record<string, any>, data: Record<string, any>): Promise<void> {
    const { schema, table: tbl } = this.parseTable(table);
    const dataCols = Object.keys(data);
    const dataVals = Object.values(data);
    const whereCols = Object.keys(where);
    const whereVals = Object.values(where);

    const hasUpdatedAt = await this.tableHasColumns(schema, table, ['updated_at']);
    const assignments: string[] = dataCols.map(c => `${c} = ?`);
    if (hasUpdatedAt && !('updated_at' in data)) assignments.push('updated_at = CURRENT_TIMESTAMP');
    const setClause = assignments.join(', ');
    const whereClause = whereCols.map(c => `${c} = ?`).join(' AND ');

    const sql = `
      UPDATE ${databricksConfig.catalog}.${schema}.${tbl}
      SET ${setClause}
      WHERE ${whereClause}
    `;
    await this.query(sql, [...dataVals, ...whereVals]);
  }

  /**
   * Upsert a record (insert or update based on condition)
   */
  async upsert(table: string, whereCondition: Record<string, any>, data: Record<string, any>): Promise<void> {
    const { schema, table: tbl } = this.parseTable(table);

    // Build WHERE clause for existence check
    const whereKeys = Object.keys(whereCondition);
    const whereValues = Object.values(whereCondition);
    const whereClause = whereKeys.map(key => `${key} = ?`).join(' AND ');

    // Determine schema columns once
    const hasUpdatedAt = await this.tableHasColumns(schema, table, ['updated_at']);
    const hasCreatedAt = await this.tableHasColumns(schema, table, ['created_at']);

    // Check if record exists
    const existingSql = `
      SELECT id FROM ${databricksConfig.catalog}.${schema}.${tbl}
      WHERE ${whereClause}
      LIMIT 1
    `;

    const existing = await this.queryOne(existingSql, whereValues);

    if (existing) {
      // Update existing record
      const updateColumns = Object.keys(data);
      const updateValues = Object.values(data);
      const assignments: string[] = updateColumns.map(col => `${col} = ?`);
      if (hasUpdatedAt) assignments.push('updated_at = CURRENT_TIMESTAMP');
      const setClause = assignments.join(', ');

      const updateSql = `
        UPDATE ${databricksConfig.catalog}.${schema}.${tbl}
        SET ${setClause}
        WHERE ${whereClause}
      `;

      await this.query(updateSql, [...updateValues, ...whereValues]);
    } else {
      // Insert new record
      const insertData: Record<string, any> = { ...whereCondition, ...data };
      if (!insertData.id) insertData.id = this.generateId();
      if (hasCreatedAt && !('created_at' in insertData)) insertData.created_at = new Date();
      if (hasUpdatedAt && !('updated_at' in insertData)) insertData.updated_at = new Date();

      await this.insert(`${schema}.${tbl}`, insertData);
    }
  }

  /**
   * Delete a record
   */
  async delete(table: string, id: string): Promise<void> {
    const { schema, table: tbl } = this.parseTable(table);
    const sql = `DELETE FROM ${databricksConfig.catalog}.${schema}.${tbl} WHERE id = ?`;
    await this.query(sql, [id]);
  }

  /**
   * Get school by domain
   */
  async getSchoolByDomain(domain: string): Promise<School | null> {
    const sql = `
      SELECT 
        id,
        name,
        domain,
        admin_email,
        subscription_tier,
        subscription_status,
        max_teachers,
        current_teachers,
        subscription_start_date,
        subscription_end_date,
        trial_ends_at,
        ferpa_agreement,
        coppa_compliant,
        data_retention_days,
        created_at,
        updated_at,
        current_teachers as teacher_count,
        0 as student_count
      FROM ${databricksConfig.catalog}.users.schools 
      WHERE domain = ? AND subscription_status IN ('active', 'trial')
    `;
    return this.queryOne<School>(sql, [domain]);
  }

  /**
   * Get teacher by Google ID
   */
  async getTeacherByGoogleId(googleId: string): Promise<Teacher | null> {
    const sql = `
      SELECT 
        t.id,
        t.google_id,
        t.email,
        t.name,
        t.picture,
        t.school_id,
        t.role,
        t.status,
        t.access_level,
        t.login_count,
        t.created_at,
        t.updated_at,
        s.name as school_name,
        s.domain as school_domain
      FROM ${databricksConfig.catalog}.users.teachers t
      JOIN ${databricksConfig.catalog}.users.schools s ON t.school_id = s.id
      WHERE t.google_id = ? AND t.status = 'active'
    `;
    return this.queryOne<Teacher>(sql, [googleId]);
  }

  /**
   * Get teacher by email
   */
  async getTeacherByEmail(email: string): Promise<Teacher | null> {
    const sql = `
      SELECT 
        t.id,
        t.google_id,
        t.email,
        t.name,
        t.picture,
        t.school_id,
        t.role,
        t.status,
        t.access_level,
        t.login_count,
        t.created_at,
        t.updated_at,
        s.name as school_name,
        s.domain as school_domain
      FROM ${databricksConfig.catalog}.users.teachers t
      JOIN ${databricksConfig.catalog}.users.schools s ON t.school_id = s.id
      WHERE t.email = ? AND t.status = 'active'
    `;
    return this.queryOne<Teacher>(sql, [email]);
  }

  /**
   * Create or update teacher - OPTIMIZED two-step process (faster than MERGE)
   */
  async upsertTeacher(teacherData: Partial<Teacher>): Promise<Teacher> {
    // Existence check
    const existingTeacher = await this.queryOne<Teacher>(
      `SELECT id, email, name, school_id, role, status, google_id FROM ${databricksConfig.catalog}.users.teachers 
       WHERE google_id = ? AND status = 'active'`,
      [teacherData.google_id]
    );

    if (existingTeacher) {
      await this.query(
        `UPDATE ${databricksConfig.catalog}.users.teachers 
         SET name = ?, picture = ?, last_login = CURRENT_TIMESTAMP(), login_count = login_count + 1, updated_at = CURRENT_TIMESTAMP()
         WHERE id = ? AND status = 'active'`,
        [teacherData.name, teacherData.picture, existingTeacher.id]
      );
      // Return fresh row
      const updated = await this.getTeacherByGoogleId(teacherData.google_id!);
      return updated as Teacher;
    }

    const now = new Date();
    const newTeacherId = this.generateId();
    const newTeacherData = {
      id: newTeacherId,
      google_id: teacherData.google_id,
      email: teacherData.email,
      name: teacherData.name,
      picture: teacherData.picture,
      school_id: teacherData.school_id,
      status: 'active' as const,
      role: 'teacher' as const,
      access_level: 'basic',
      max_concurrent_sessions: 3,
      current_sessions: 0,
      timezone: 'UTC',
      login_count: 1,
      total_sessions_created: 0,
      last_login: now,
      created_at: now,
      updated_at: now,
    };
    await this.insert('teachers', newTeacherData);
    const created = await this.getTeacherByGoogleId(teacherData.google_id!);
    return created as Teacher;
  }

  /**
   * Get sessions for a teacher
   */
  async getTeacherSessions(teacherId: string, limit: number = 10): Promise<Session[]> {
    const sql = `
      SELECT s.id,
             s.title,
             s.description,
             s.status,
             s.scheduled_start,
             s.actual_start,
             s.actual_end,
             s.planned_duration_minutes,
             s.actual_duration_minutes,
             s.target_group_size,
             s.auto_group_enabled,
             s.teacher_id,
             s.school_id,
             s.recording_enabled,
             s.transcription_enabled,
             s.ai_analysis_enabled,
             s.ferpa_compliant,
             s.coppa_compliant,
             s.recording_consent_obtained,
             s.data_retention_date,
             s.total_groups,
             s.total_students,
             CAST(0.0 AS DOUBLE) AS participation_rate,
             CAST(0.0 AS DOUBLE) AS engagement_score,
             s.created_at,
             s.updated_at,
             COUNT(DISTINCT g.id) as group_count,
             COALESCE(SUM(g.current_size), 0) as student_count
      FROM ${databricksConfig.catalog}.sessions.classroom_sessions s
      LEFT JOIN ${databricksConfig.catalog}.sessions.student_groups g ON s.id = g.session_id
      WHERE s.teacher_id = ?
      GROUP BY s.id, s.title, s.description, s.status, s.scheduled_start, s.actual_start, s.actual_end,
               s.planned_duration_minutes, s.actual_duration_minutes, s.target_group_size,
               s.auto_group_enabled, s.teacher_id, s.school_id, s.recording_enabled, s.transcription_enabled,
               s.ai_analysis_enabled, s.ferpa_compliant, s.coppa_compliant, s.recording_consent_obtained,
               s.data_retention_date, s.total_groups, s.total_students, s.created_at, s.updated_at
      ORDER BY s.created_at DESC
      LIMIT ?
    `;
    return this.query<Session>(sql, [teacherId, limit]);
  }

  /**
   * Generate a 6-character access code
   */
  generateAccessCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Create a new session
   */
  async createSession(sessionData: CreateSessionData): Promise<{
    sessionId: string;
    accessCode: string;
    createdAt: Date;
  }> {
    const sessionId = this.generateId();
    const accessCode = this.generateAccessCode();
    const createdAt = new Date();
    
    // Skip collision checking for now - 36^6 = 2+ billion combinations, collision is extremely rare
    // In production, you could add collision checking or use UUIDs + short codes
    let finalCode = accessCode;
    
    const data = {
      id: sessionId,
      title: sessionData.title,
      description: sessionData.description,
      teacher_id: sessionData.teacherId,
      school_id: sessionData.schoolId,
      access_code: accessCode,
      target_group_size: sessionData.targetGroupSize || 4,
      auto_group_enabled: sessionData.autoGroupEnabled ?? true,
      scheduled_start: sessionData.scheduledStart,
      planned_duration_minutes: sessionData.plannedDuration || 45,
      status: 'created',
      recording_enabled: true,
      transcription_enabled: true,
      ai_analysis_enabled: true,
      ferpa_compliant: true,
      coppa_compliant: true,
      recording_consent_obtained: false,
      total_groups: 0,
      total_students: 0,
      engagement_score: 0.0,
      created_at: createdAt,
      updated_at: createdAt,
    };
    
    console.log('🔍 Attempting to insert session with data:', JSON.stringify(data, null, 2));
    await this.insert('classroom_sessions', data);
    
    // Return the data we already have instead of querying again
    return {
      sessionId,
      accessCode: finalCode,
      createdAt,
    };
  }

  /**
   * Update session status
   */
  async updateSessionStatus(sessionId: string, status: SessionStatus, additionalData: any = {}): Promise<void> {
    const updateData: any = {
      status,
    };
    
    // Only add fields that exist in the classroom_sessions table schema
    const allowedFields = [
      'title', 'description', 'goal', 'subject', 'status', 'scheduled_start', 'actual_start', 'actual_end',
      'planned_duration_minutes', 'actual_duration_minutes', 'target_group_size',
      'auto_group_enabled', 'recording_enabled', 'transcription_enabled', 'ai_analysis_enabled',
      'ferpa_compliant', 'coppa_compliant', 'recording_consent_obtained', 'data_retention_date',
      'total_groups', 'total_students', 'engagement_score', 'updated_at'
    ];
    
    // Filter additionalData to only include allowed fields
    for (const [key, value] of Object.entries(additionalData)) {
      if (allowedFields.includes(key)) {
        updateData[key] = value;
      }
    }
    
    // CRITICAL: Always set updated_at to current time
    updateData.updated_at = new Date();
    
    if (status === 'active' && !updateData.actual_start) {
      updateData.actual_start = new Date();
    }
    
    if (status === 'ended' && !updateData.actual_end) {
      updateData.actual_end = new Date();
      
      // Calculate actual duration
      const session = await this.queryOne<{ actual_start: Date }>(
        `SELECT actual_start FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ?`,
        [sessionId]
      );
      
      if (session?.actual_start) {
        const startTime = new Date(session.actual_start);
        const endTime = new Date();
        const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));
        updateData.actual_duration_minutes = durationMinutes;
      }
    }
    
    await this.update('classroom_sessions', sessionId, updateData);
  }

  /**
   * Record audit log entry
   */
  async recordAuditLog(auditData: {
    actorId: string;
    actorType: 'teacher' | 'student' | 'system' | 'admin';
    eventType: string;
    eventCategory: 'authentication' | 'session' | 'data_access' | 'configuration' | 'compliance';
    resourceType: string;
    resourceId: string;
    schoolId: string;
    description: string;
    ipAddress?: string;
    userAgent?: string;
    complianceBasis?: 'ferpa' | 'coppa' | 'legitimate_interest' | 'consent';
    dataAccessed?: string;
    affectedStudentIds?: string[];
  }): Promise<void> {
    const auditId = this.generateId();
    
    const data = {
      id: auditId,
      actor_id: auditData.actorId,
      actor_type: auditData.actorType,
      event_type: auditData.eventType,
      event_category: auditData.eventCategory,
      event_timestamp: new Date(),
      resource_type: auditData.resourceType,
      resource_id: auditData.resourceId,
      school_id: auditData.schoolId,
      description: auditData.description,
      ip_address: auditData.ipAddress,
      user_agent: auditData.userAgent,
      compliance_basis: auditData.complianceBasis,
      data_accessed: auditData.dataAccessed,
      affected_student_ids: auditData.affectedStudentIds ? JSON.stringify(auditData.affectedStudentIds) : null,
      created_at: new Date(),
    };
    
    await this.insert('audit_log', data);
  }

  /**
   * Record multiple audit log entries in a single batch (canonical batch API)
   */
  async recordAuditLogBatch(rows: Array<{
    id?: string;
    actor_id: string;
    actor_type: 'teacher' | 'student' | 'system' | 'admin';
    event_type: string;
    event_category: string;
    event_timestamp?: Date;
    resource_type: string;
    resource_id?: string | null;
    school_id: string;
    session_id?: string | null;
    description?: string;
    ip_address?: string | null;
    user_agent?: string | null;
    compliance_basis?: string | null;
    data_accessed?: string | null;
    affected_student_ids?: string[] | string | null;
    created_at?: Date;
  }>): Promise<void> {
    if (!rows || rows.length === 0) return;
    const norm = rows.map((r) => ({
      id: r.id || this.generateId(),
      actor_id: r.actor_id,
      actor_type: r.actor_type,
      event_type: r.event_type,
      event_category: r.event_category,
      event_timestamp: r.event_timestamp || new Date(),
      resource_type: r.resource_type,
      resource_id: r.resource_id ?? null,
      school_id: r.school_id,
      session_id: r.session_id ?? null,
      description: r.description || '',
      ip_address: r.ip_address ?? null,
      user_agent: r.user_agent ?? null,
      compliance_basis: r.compliance_basis ?? null,
      data_accessed: r.data_accessed ?? null,
      affected_student_ids: Array.isArray(r.affected_student_ids)
        ? JSON.stringify(r.affected_student_ids)
        : (r.affected_student_ids ?? null),
      created_at: r.created_at || new Date(),
    }));
    await this.batchInsert('audit_log', norm);
  }

  /**
   * OPTIMIZED: Batch auth operations to reduce database round trips
   */
  async batchAuthOperations(googleUser: any, domain: string): Promise<{
    school: any;
    teacher: any;
  }> {
    console.log('🚀 BATCH AUTH OPERATIONS START');
    const batchStart = performance.now();
    
    // Single query to get school and teacher data together
    const sql = `
      WITH school_lookup AS (
        SELECT 
          s.id,
          s.name,
          s.domain,
          s.subscription_tier,
          s.subscription_status,
          s.current_teachers as teacher_count,
          0 as student_count
        FROM ${databricksConfig.catalog}.users.schools s
        WHERE s.domain = ? AND s.subscription_status IN ('active', 'trial')
      ),
      teacher_lookup AS (
        SELECT 
          t.school_id,
          t.id,
          t.email,
          t.name,
          t.role,
          t.access_level,
          t.login_count,
          s.name as school_name, 
          s.domain as school_domain
        FROM ${databricksConfig.catalog}.users.teachers t
        JOIN ${databricksConfig.catalog}.users.schools s ON t.school_id = s.id
        WHERE t.google_id = ? AND t.status = 'active'
      )
      SELECT 
        'school' as type,
        s.id as school_id,
        s.name as school_name,
        s.domain as school_domain,
        s.subscription_tier,
        s.subscription_status,
        s.teacher_count,
        s.student_count,
        NULL as teacher_id,
        NULL as teacher_email,
        NULL as teacher_name,
        NULL as teacher_role,
        NULL as teacher_access_level,
        NULL as teacher_login_count
      FROM school_lookup s
      UNION ALL
      SELECT 
        'teacher' as type,
        t.school_id,
        t.school_name,
        t.school_domain,
        NULL as subscription_tier,
        NULL as subscription_status,
        NULL as teacher_count,
        NULL as student_count,
        t.id as teacher_id,
        t.email as teacher_email,
        t.name as teacher_name,
        t.role as teacher_role,
        t.access_level as teacher_access_level,
        t.login_count as teacher_login_count
      FROM teacher_lookup t
    `;
    
    const results = await this.query(sql, [domain, googleUser.id]);
    
    const schoolResult = results.find(r => r.type === 'school');
    const teacherResult = results.find(r => r.type === 'teacher');
    
    if (!schoolResult) {
      throw new Error('School not found or not authorized');
    }
    
    const school = {
      id: schoolResult.school_id,
      name: schoolResult.school_name,
      domain: schoolResult.school_domain,
      subscription_tier: schoolResult.subscription_tier,
      subscription_status: schoolResult.subscription_status,
      teacher_count: schoolResult.teacher_count,
      student_count: schoolResult.student_count,
    };
    
    let teacher;
    if (teacherResult) {
      // Update existing teacher
      const updateData = {
        name: googleUser.name,
        picture: googleUser.picture,
        last_login: new Date(),
        login_count: teacherResult.teacher_login_count + 1,
      };
      
      await this.update('teachers', teacherResult.teacher_id, updateData);
      
      teacher = {
        id: teacherResult.teacher_id,
        google_id: googleUser.id,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture,
        school_id: school.id,
        role: teacherResult.teacher_role,
        status: 'active',
        access_level: teacherResult.teacher_access_level,
        login_count: teacherResult.teacher_login_count + 1,
        last_login: new Date(),
      };
    } else {
      // Create new teacher
      const newTeacher = {
        id: this.generateId(),
        google_id: googleUser.id,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture,
        school_id: school.id,
        status: 'active' as const,
        role: 'teacher' as const,
        access_level: 'basic',
        max_concurrent_sessions: 3,
        current_sessions: 0,
        timezone: 'UTC',
        login_count: 1,
        total_sessions_created: 0,
        last_login: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };
      
      await this.insert('teachers', newTeacher);
      teacher = newTeacher;
    }
    
    const batchTotal = performance.now() - batchStart;
    console.log(`🚀 BATCH AUTH OPERATIONS COMPLETE - Total time: ${batchTotal.toFixed(2)}ms`);
    
    return { school, teacher };
  }

  // Removed: transcribeAudio/transcribeWithMetrics (STT migrated to OpenAI Whisper)

  /**
   * Health probe with strict timeout; returns minimal data for readiness
   */
  async healthProbe(timeoutMs?: number): Promise<{ ok: boolean; durations: { total: number }; breaker: { state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; consecutiveFailures: number; since: number }; serverTime?: string }>{
    const t0 = Date.now();
    try {
      const sql = 'SELECT 1 as ok, current_timestamp() as server_time';
      const original = databricksConfig.queryTimeoutMs;
      // Temporarily override timeout for probe
      (databricksConfig as any).queryTimeoutMs = timeoutMs || Math.min(original, 1500);
      const row = await this.queryOne<{ ok: number; server_time: string }>(sql);
      (databricksConfig as any).queryTimeoutMs = original;
      return { ok: !!row, durations: { total: Date.now() - t0 }, breaker: this.getCircuitBreakerStatus(), serverTime: row?.server_time };
    } catch {
      return { ok: false, durations: { total: Date.now() - t0 }, breaker: this.getCircuitBreakerStatus() };
    }
  }
}

// Create singleton instance
let databricksServiceInstance: DatabricksService | null = null;

export const getDatabricksService = (): DatabricksService => {
  if (!databricksServiceInstance) {
    databricksServiceInstance = new DatabricksService();
  }
  return databricksServiceInstance;
};

// Export for backward compatibility
export const databricksService = {
  connect: () => getDatabricksService().connect(),
  disconnect: () => getDatabricksService().disconnect(),
  query: <T = any>(sql: string, params: any[] = []) => getDatabricksService().query<T>(sql, params),
  queryOne: <T = any>(sql: string, params: any[] = []) => getDatabricksService().queryOne<T>(sql, params),
  healthProbe: (timeoutMs?: number) => getDatabricksService().healthProbe(timeoutMs),
  getBreakerStatus: () => getDatabricksService().getCircuitBreakerStatus(),
  generateId: () => getDatabricksService().generateId(),
  insert: (table: string, data: Record<string, any>) => getDatabricksService().insert(table, data),
  batchInsert: (table: string, rows: Record<string, any>[]) => getDatabricksService().batchInsert(table, rows),
  update: (table: string, id: string, data: Record<string, any>) => getDatabricksService().update(table, id, data),
  updateWhere: (table: string, where: Record<string, any>, data: Record<string, any>) => getDatabricksService().updateWhere(table, where, data),
  upsert: (table: string, whereCondition: Record<string, any>, data: Record<string, any>) => getDatabricksService().upsert(table, whereCondition, data),
  delete: (table: string, id: string) => getDatabricksService().delete(table, id),
  mapStringString: (obj: Record<string, string | null | undefined>) => getDatabricksService().toMapStringString(obj),
  tableHasColumns: (schema: string, table: string, columns: string[]) => getDatabricksService().tableHasColumns(schema, table, columns),
  getSchoolByDomain: (domain: string) => getDatabricksService().getSchoolByDomain(domain),
  getTeacherByGoogleId: (googleId: string) => getDatabricksService().getTeacherByGoogleId(googleId),
  getTeacherByEmail: (email: string) => getDatabricksService().getTeacherByEmail(email),
  upsertTeacher: (teacherData: Partial<Teacher>) => getDatabricksService().upsertTeacher(teacherData),
  getTeacherSessions: (teacherId: string, limit?: number) => getDatabricksService().getTeacherSessions(teacherId, limit),
  createSession: (sessionData: CreateSessionData) => getDatabricksService().createSession(sessionData),
  updateSessionStatus: (sessionId: string, status: SessionStatus, additionalData?: any) => getDatabricksService().updateSessionStatus(sessionId, status, additionalData),
  recordAuditLog: (auditData: any) => getDatabricksService().recordAuditLog(auditData),
  recordAuditLogBatch: (rows: any[]) => getDatabricksService().recordAuditLogBatch(rows),
  batchAuthOperations: (googleUser: any, domain: string) => getDatabricksService().batchAuthOperations(googleUser, domain),
  // STT removed
};
