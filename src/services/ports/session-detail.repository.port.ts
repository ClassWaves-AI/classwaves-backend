export interface SessionDetailRepositoryPort {
  /**
   * Returns a session row with the minimal projection required for detail view
   * if the session belongs to the teacher.
   */
  getOwnedSessionDetail(sessionId: string, teacherId: string): Promise<any | null>;
}

