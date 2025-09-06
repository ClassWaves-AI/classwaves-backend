export interface SessionStats {
  total_groups: number;
  total_students: number;
  total_transcriptions: number;
}

export interface SessionStatsRepositoryPort {
  getEndSessionStats(sessionId: string): Promise<SessionStats>;
}

