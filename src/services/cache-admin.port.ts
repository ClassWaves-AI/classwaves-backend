export interface CacheAdminPort {
  // Return all keys matching the pattern using SCAN (batched under the hood)
  scan(matchPattern: string, count?: number): Promise<string[]>;

  // Delete multiple keys (DEL); returns number deleted
  deleteMany(keys: string[]): Promise<number>;

  // Prefer non-blocking unlink when available
  unlinkMany(keys: string[]): Promise<number>;

  // Convenience: delete by one or more patterns via SCAN + UNLINK/DEL
  deleteByPattern(patterns: string[], count?: number): Promise<number>;
}

