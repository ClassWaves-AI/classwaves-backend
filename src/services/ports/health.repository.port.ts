export interface HealthRepositoryPort {
  getServerTime(): Promise<{ health_check: number; server_time: string } | null>;
  countFromTable(tableFqn: string): Promise<number>;
}

