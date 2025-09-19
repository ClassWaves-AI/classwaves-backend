export interface GroupSummary {
  overview: string;
  participation?: {
    notableContributors?: string[];
    dynamics?: string;
  };
  misconceptions?: string[];
  highlights?: Array<{ quote: string; context?: string }>;
  teacher_actions?: Array<{ action: string; priority?: 'low' | 'medium' | 'high' }>;
  metadata?: Record<string, unknown>;
  analysisTimestamp?: string;
}

export interface SessionSummary {
  themes: string[];
  strengths?: string[];
  needs?: string[];
  teacher_actions?: Array<{ action: string; priority?: 'low' | 'medium' | 'high' }>;
  group_breakdown?: Array<{ groupId: string; name?: string; summarySnippet?: string }>;
  metadata?: Record<string, unknown>;
  analysisTimestamp?: string;
}

export interface GroupSummaryRecord {
  id: string;
  session_id: string;
  group_id: string;
  summary_json: string; // JSON string in storage
  analysis_timestamp: Date;
  created_at: Date;
}

export interface SessionSummaryRecord {
  id: string;
  session_id: string;
  summary_json: string; // JSON string in storage
  analysis_timestamp: Date;
  created_at: Date;
}

