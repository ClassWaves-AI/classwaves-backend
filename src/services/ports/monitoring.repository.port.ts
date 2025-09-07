export interface MonitoringRepositoryPort {
  executeSql(sql: string): Promise<any[]>;
  describeTable(tableFqn: string): Promise<any>;
}

