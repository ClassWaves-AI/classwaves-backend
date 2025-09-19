export interface DbQueryOptions {
  /**
   * Optional label for metrics/logging to indicate logical operation (e.g., selectSessionById).
   */
  operation?: string;
}

export interface DbTransactionPort {
  query<T = any>(sql: string, params?: unknown[], options?: DbQueryOptions): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: unknown[], options?: DbQueryOptions): Promise<T | null>;
  insert(tableFqn: string, row: Record<string, unknown>, options?: DbQueryOptions): Promise<void>;
  update(
    tableFqn: string,
    id: string,
    patch: Record<string, unknown>,
    idColumn?: string,
    options?: DbQueryOptions
  ): Promise<void>;
  upsert(
    tableFqn: string,
    keyColumns: string[],
    row: Record<string, unknown>,
    options?: DbQueryOptions
  ): Promise<void>;
  tableHasColumns(schema: string, table: string, columns: string[]): Promise<boolean>;
}

export interface DbPort extends DbTransactionPort {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  withTransaction<T>(handler: (tx: DbTransactionPort) => Promise<T>): Promise<T>;
  generateId(): string;
}
