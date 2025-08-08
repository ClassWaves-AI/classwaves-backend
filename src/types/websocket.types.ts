export interface WebSocketUser {
  userId: string;
  sessionId: string;
  schoolId: string;
  role: string;
  displayName?: string;
}

export interface SessionMessage {
  id: string;
  sessionCode: string;
  userId: string;
  displayName: string;
  message: string;
  timestamp: Date;
  type: 'text' | 'system' | 'action';
}

export interface SessionParticipant {
  userId: string;
  displayName: string;
  role: 'teacher' | 'student';
  status: 'active' | 'idle' | 'away';
  joinedAt: Date;
}

export interface GroupUpdate {
  groupId: string;
  groupName: string;
  members: string[];
  action: 'created' | 'updated' | 'deleted';
}

export interface ActivityUpdate {
  activityId: string;
  activityType: string;
  status: 'started' | 'paused' | 'completed';
  data?: any;
}

export interface TranscriptionUpdate {
  sessionCode: string;
  speakerId: string;
  text: string;
  timestamp: Date;
  confidence: number;
}

// WebSocket event names
export enum WSEvents {
  // Connection events
  CONNECTION = 'connection',
  DISCONNECT = 'disconnect',
  ERROR = 'error',
  
  // Session events
  JOIN_SESSION = 'joinSession',
  LEAVE_SESSION = 'leaveSession',
  SESSION_JOINED = 'sessionJoined',
  SESSION_LEFT = 'sessionLeft',
  SESSION_ENDED = 'sessionEnded',
  
  // Messaging events
  SEND_MESSAGE = 'sendMessage',
  MESSAGE_RECEIVED = 'messageReceived',
  
  // Presence events
  UPDATE_PRESENCE = 'updatePresence',
  PRESENCE_UPDATED = 'presenceUpdated',
  
  // Group events
  GROUP_UPDATE = 'groupUpdate',
  JOIN_GROUP = 'joinGroup',
  LEAVE_GROUP = 'leaveGroup',
  
  // Activity events
  ACTIVITY_UPDATE = 'activityUpdate',
  
  // Transcription events
  TRANSCRIPTION_UPDATE = 'transcriptionUpdate',
  
  // Hand raising
  RAISE_HAND = 'raiseHand',
  LOWER_HAND = 'lowerHand',
  HAND_STATUS_CHANGED = 'handStatusChanged',
}