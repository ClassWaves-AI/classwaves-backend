export interface GuidanceTier1Snippet {
  timestamp: Date;
  groupId: string;
  groupName?: string;
  text: string;
}

export interface GuidanceInsightsRepositoryPort {
  /**
   * Return recent Tier 1 insight snippets for a session, newest first.
   * Implementations must avoid SELECT * and project only needed fields.
   */
  listTier1SnippetsBySession(sessionId: string, limit?: number): Promise<GuidanceTier1Snippet[]>;

  /**
   * Return the latest Tier 2 deep analysis object for the session, or null if none.
   * The returned value should be a parsed object with minimal fields, not raw string.
   */
  getLatestTier2BySession(sessionId: string): Promise<any | null>;

  /**
   * Return recent Tier 1 insight snippets for a specific group in a session.
   */
  listTier1ByGroup(sessionId: string, groupId: string, limit?: number): Promise<GuidanceTier1Snippet[]>;
}
