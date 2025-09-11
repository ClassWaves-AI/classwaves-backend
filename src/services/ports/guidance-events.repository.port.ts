export type GuidanceEventType = 'tier1' | 'tier2' | 'prompt';

export interface GuidanceEventRecord {
  id: string;
  sessionId: string;
  groupId?: string | null;
  type: GuidanceEventType;
  payloadJson: string;
  timestamp: Date;
}

export interface GuidanceEventsRepositoryPort {
  insert(event: GuidanceEventRecord): Promise<void>;
}

