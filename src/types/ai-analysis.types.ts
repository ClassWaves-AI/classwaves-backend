/**
 * AI Analysis Type Definitions
 * 
 * Defines interfaces for the Two-Tier AI Analysis System:
 * - Tier 1: Real-time analysis (30s cadence) - Topical Cohesion, Conceptual Density
 * - Tier 2: Deep analysis (2-5min) - Argumentation Quality, Emotional Arc
 */

// ============================================================================
// Tier 1 Analysis Types (30s Real-time Insights)
// ============================================================================

export interface Tier1Options {
  groupId: string;
  sessionId: string;
  focusAreas?: ('topical_cohesion' | 'conceptual_density')[];
  windowSize?: number; // seconds, default 30
  includeMetadata?: boolean;
  // Injected teacher-provided context for anchoring analysis
  sessionContext?: {
    subject?: string;
    topic?: string;
    goals?: string[];
    description?: string;
  };
}

export interface Tier1Insights {
  // Core metrics
  topicalCohesion: number; // 0-1 score: how well group stays on topic
  conceptualDensity: number; // 0-1 score: sophistication of language/concepts
  offTopicHeat?: number; // 0-1: inverted on-track heat (computed when missing)
  discussionMomentum?: number; // -1 to 1: slope of topical cohesion EMA
  confusionRisk?: number; // 0-1 probability of misconceptions
  energyLevel?: number; // 0-1 blended lexical & energy baseline
  
  // Contextual data
  analysisTimestamp: string;
  windowStartTime: string;
  windowEndTime: string;
  transcriptLength: number;
  confidence: number; // 0-1 confidence in analysis
  
  // Actionable insights
  insights: {
    type: 'topical_cohesion' | 'conceptual_density';
    message: string;
    severity: 'info' | 'warning' | 'success';
    actionable?: string; // Teacher suggestion
  }[];
  
  // Optional metadata
  metadata?: {
    processingTimeMs: number;
    modelVersion: string;
    rawScores?: Record<string, number>;
  };
}

// ============================================================================
// Tier 2 Analysis Types (2-5min Deep Insights)
// ============================================================================

export interface Tier2Options {
  sessionId: string;
  groupIds?: string[]; // Analyze specific groups or all
  analysisDepth: 'standard' | 'comprehensive';
  includeComparative?: boolean; // Cross-group comparisons
  includeMetadata?: boolean;
  // Optional explicit per-group scope (preferred over groupIds for live triggers)
  groupId?: string;
  // Injected teacher-provided context for anchoring analysis
  sessionContext?: {
    subject?: string;
    topic?: string;
    goals?: string[];
    description?: string;
  };
}

export interface Tier2Insights {
  // Core deep metrics
  argumentationQuality: {
    score: number; // 0-1 overall quality
    claimEvidence: number; // How well claims are supported
    logicalFlow: number; // Logical progression of ideas
    counterarguments: number; // Consideration of alternatives
    synthesis: number; // Integration of multiple perspectives
  };

  // Emotional Arc (session- or group-level depending on metadata.scope)
  collectiveEmotionalArc: {
    trajectory: 'ascending' | 'descending' | 'stable' | 'volatile';
    averageEngagement: number; // 0-1 engagement level
    energyPeaks: number[]; // Timestamps of high energy
    sentimentFlow: {
      timestamp: string;
      sentiment: number; // -1 to 1
      confidence: number;
    }[];
  };
  // Optional alias when provider responds with group-scoped field name
  // This field may be normalized into collectiveEmotionalArc by parsers
  groupEmotionalArc?: Tier2Insights['collectiveEmotionalArc'];
  
  // Group dynamics
  collaborationPatterns: {
    turnTaking: number; // 0-1 balanced participation
    buildingOnIdeas: number; // How well ideas are developed together
    conflictResolution: number; // Handling of disagreements
    inclusivity: number; // All voices heard
  };
  
  // Learning indicators
  learningSignals: {
    conceptualGrowth: number; // Evidence of understanding development
    questionQuality: number; // Depth and relevance of questions
    metacognition: number; // Awareness of own thinking
    knowledgeApplication: number; // Applying concepts to new contexts
  };
  
  // Contextual data
  analysisTimestamp: string;
  sessionStartTime: string;
  analysisEndTime: string;
  totalTranscriptLength: number;
  groupsAnalyzed: string[];
  confidence: number;
  
  // Teacher recommendations
  recommendations: {
    type: 'intervention' | 'praise' | 'redirect' | 'deepen';
    priority: 'low' | 'medium' | 'high';
    message: string;
    suggestedAction: string;
    targetGroups?: string[];
  }[];
  
  // Optional comparative analysis
  crossGroupComparison?: {
    groupId: string;
    relativePerfomance: {
      argumentation: number;
      collaboration: number;
      engagement: number;
    };
  }[];
  
  // Optional metadata
  metadata?: {
    processingTimeMs: number;
    modelVersion: string;
    analysisModules: string[];
    rawScores?: Record<string, any>;
    // Added to clarify scope and origin for Tier2
    scope?: 'group' | 'session';
    groupId?: string;
  };
}

// ============================================================================
// Request/Response Types
// ============================================================================

export interface AnalyzeGroupDiscussionRequest {
  groupId: string;
  sessionId: string;
  transcripts: string[];
  options?: Tier1Options;
}

export interface AnalyzeGroupDiscussionResponse {
  success: boolean;
  insights: Tier1Insights;
  processingTime: number;
  error?: string;
}

export interface GenerateDeepInsightsRequest {
  sessionId: string;
  groupTranscripts: {
    groupId: string;
    transcripts: string[];
  }[];
  options?: Tier2Options;
}

export interface GenerateDeepInsightsResponse {
  success: boolean;
  insights: Tier2Insights;
  processingTime: number;
  error?: string;
}

export interface GetSessionInsightsRequest {
  sessionId: string;
  includeHistory?: boolean;
  groupIds?: string[];
}

export interface GetSessionInsightsResponse {
  success: boolean;
  tier1Insights: Record<string, Tier1Insights[]>; // groupId -> insights[]
  tier2Insights: Tier2Insights[];
  error?: string;
}

// ============================================================================
// Databricks API Types
// ============================================================================

export interface DatabricksAIRequest {
  messages: {
    role: 'user' | 'assistant' | 'system';
    content: string;
  }[];
  max_tokens: number;
  temperature: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

export interface DatabricksAIResponse {
  choices: {
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
    index: number;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  id: string;
  object: string;
  created: number;
  model: string;
}

// ============================================================================
// Buffer and Windowing Types
// ============================================================================

export interface TranscriptBuffer {
  transcripts: string[];
  windowStart: Date;
  lastUpdate: Date;
  lastAnalysis?: Date;
  groupId?: string;
  sessionId: string;
}

export interface AnalysisWindow {
  id: string;
  type: 'tier1' | 'tier2';
  sessionId: string;
  groupId?: string;
  startTime: Date;
  endTime: Date;
  transcripts: string[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  insights?: Tier1Insights | Tier2Insights;
  processingTime?: number;
  error?: string;
}

// ============================================================================
// WebSocket Event Types
// ============================================================================

export interface GroupTier1Insight {
  groupId: string;
  sessionId: string;
  insights: Tier1Insights;
  timestamp: string;
}

export interface SessionTier2Insight {
  sessionId: string;
  insights: Tier2Insights;
  timestamp: string;
}

// ============================================================================
// Service Configuration Types
// ============================================================================

export interface AIAnalysisConfig {
  tier1: {
    endpoint: string;
    timeout: number;
    windowSeconds: number;
    maxTokens: number;
    temperature: number;
  };
  tier2: {
    endpoint: string;
    timeout: number;
    windowMinutes: number;
    maxTokens: number;
    temperature: number;
  };
  databricks: {
    token: string;
    workspaceUrl: string;
  };
  retries: {
    maxAttempts: number;
    backoffMs: number;
    jitter: boolean;
  };
}

// ============================================================================
// Error Types
// ============================================================================

export interface AIAnalysisError extends Error {
  code: 'DATABRICKS_TIMEOUT' | 'DATABRICKS_AUTH' | 'DATABRICKS_QUOTA' | 'ANALYSIS_FAILED' | 'INVALID_INPUT';
  details?: any;
  tier?: 'tier1' | 'tier2';
  groupId?: string;
  sessionId?: string;
}

// ============================================================================
// Utility Types
// ============================================================================

export type AnalysisTier = 'tier1' | 'tier2';
export type InsightType = 'topical_cohesion' | 'conceptual_density' | 'argumentation_quality' | 'emotional_arc' | 'collaboration_patterns' | 'learning_signals';
export type SeverityLevel = 'info' | 'warning' | 'success' | 'error';
export type RecommendationType = 'intervention' | 'praise' | 'redirect' | 'deepen';
export type PriorityLevel = 'low' | 'medium' | 'high';
