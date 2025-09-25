/**
 * Teacher Guidance System Type Definitions
 * 
 * Defines interfaces for the teacher guidance and prompt system:
 * - Teacher prompt types and metadata
 * - Interaction tracking and analytics
 * - Database schema interfaces
 * - API request/response types
 */

// ============================================================================
// Core Teacher Guidance Types
// ============================================================================

export interface TeacherPrompt {
  id: string;
  sessionId: string;
  teacherId: string;
  groupId?: string; // Optional - can be session-wide prompts
  
  // Prompt content
  category: PromptCategory;
  priority: PromptPriority;
  message: string;
  context: string;
  suggestedTiming: PromptTiming;
  
  // Metadata
  generatedAt: Date;
  expiresAt: Date;
  acknowledgedAt?: Date;
  usedAt?: Date;
  dismissedAt?: Date;
  
  // Educational context
  sessionPhase: SessionPhase;
  subject: SubjectArea;
  targetMetric?: string; // Which AI insight triggered this prompt
  learningObjectives?: string[];
  contextSummary?: string;
  contextEvidence?: {
    actionLine?: string;
    reason?: string;
    priorTopic?: string;
    currentTopic?: string;
    transitionIdea?: string;
    contextSummary?: string;
    quotes?: Array<{ speakerLabel: string; text: string; timestamp: string }>;
    supportingLines?: Array<{ speaker: string; quote: string; timestamp: string }>;
    confidence?: number;
  };
  bridgingPrompt?: string;
  onTrackSummary?: string;
  why?: {
    alignmentDelta?: number;
    driftSeconds?: number;
    inputQuality?: number;
  };
  
  // Effectiveness
  effectivenessScore?: number;
  feedbackRating?: number; // 1-5 scale
  feedbackText?: string;
  impactConfidence?: number;
  
  // System tracking
  createdAt: Date;
  updatedAt: Date;
}

export interface TeacherGuidanceMetrics {
  id: string;
  sessionId: string;
  teacherId: string;
  promptId: string;
  
  // Interaction tracking
  promptCategory: PromptCategory;
  priorityLevel: PromptPriority;
  generatedAt: Date;
  acknowledgedAt?: Date;
  usedAt?: Date;
  dismissedAt?: Date;
  
  // Feedback
  feedbackRating?: number; // 1-5 scale
  feedbackText?: string;
  effectivenessScore?: number;
  impactConfidence?: number;
  
  // Educational impact
  learningOutcomeImprovement?: number; // Measured impact on student engagement/learning
  sessionPhaseImpact?: string; // Which phase this intervention affected
  
  // System metadata
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Enum Types
// ============================================================================

export type PromptCategory = 
  | 'facilitation'     // Help with group dynamics and process
  | 'deepening'        // Encourage deeper thinking/analysis
  | 'redirection'      // Get back on track/topic
  | 'collaboration'    // Improve group interaction
  | 'assessment'       // Check understanding/progress
  | 'energy'           // Boost engagement/motivation
  | 'clarity';         // Clarify confusion/misconceptions

export type PromptPriority = 'high' | 'medium' | 'low';

export type PromptTiming = 
  | 'immediate'        // Act on this right now
  | 'next_break'       // Wait for natural pause
  | 'session_end';     // Address during wrap-up

export type SessionPhase = 
  | 'opening'          // Session introduction/warm-up
  | 'development'      // Main learning activities
  | 'synthesis'        // Bringing ideas together
  | 'closure';         // Wrap-up and reflection

export type SubjectArea = 
  | 'math' 
  | 'science' 
  | 'literature' 
  | 'history' 
  | 'general';

export type InteractionType = 
  | 'acknowledged'     // Teacher saw the prompt
  | 'used'            // Teacher acted on the prompt
  | 'dismissed';      // Teacher explicitly dismissed

// ============================================================================
// Request/Response Types
// ============================================================================

export interface GeneratePromptsRequest {
  sessionId: string;
  groupId?: string;
  insights: any; // Tier1Insights | Tier2Insights (from ai-analysis.types.ts)
  context: {
    sessionPhase: SessionPhase;
    subject: SubjectArea;
    learningObjectives: string[];
    groupSize: number;
    sessionDuration: number; // minutes
    teacherId: string;
  };
  options?: {
    maxPrompts?: number;
    priorityFilter?: PromptPriority | 'all';
    categoryFilter?: PromptCategory[];
    includeEffectivenessScore?: boolean;
  };
}

export interface GeneratePromptsResponse {
  success: boolean;
  prompts: TeacherPrompt[];
  metadata: {
    totalGenerated: number;
    processingTimeMs: number;
    insightSource: 'tier1' | 'tier2';
    sessionPhase: SessionPhase;
  };
  error?: string;
}

export interface RecordPromptInteractionRequest {
  promptId: string;
  sessionId: string;
  teacherId: string;
  interactionType: InteractionType;
  feedback?: {
    rating: number; // 1-5
    text: string;
  };
  outcomeData?: {
    learningImpact?: number; // Measured impact
    followupNeeded?: boolean;
    notes?: string;
  };
}

export interface RecordPromptInteractionResponse {
  success: boolean;
  interactionId: string;
  updatedPrompt: TeacherPrompt;
  error?: string;
}

export interface GetSessionPromptsRequest {
  sessionId: string;
  teacherId: string;
  filters?: {
    category?: PromptCategory;
    priority?: PromptPriority;
    status?: 'active' | 'acknowledged' | 'used' | 'dismissed' | 'expired';
    groupId?: string;
  };
}

export interface GetSessionPromptsResponse {
  success: boolean;
  prompts: TeacherPrompt[];
  stats: {
    totalActive: number;
    byCategory: Record<PromptCategory, number>;
    byPriority: Record<PromptPriority, number>;
    averageEffectiveness: number;
  };
  error?: string;
}

// ============================================================================
// Analytics and Reporting Types
// ============================================================================

export interface TeacherGuidanceAnalytics {
  sessionId: string;
  teacherId: string;
  schoolId: string;
  
  // Usage metrics
  totalPromptsGenerated: number;
  totalPromptsAcknowledged: number;
  totalPromptsUsed: number;
  totalPromptsDismissed: number;
  
  // Effectiveness metrics
  acknowledgemntRate: number; // percentage
  usageRate: number; // percentage
  averageFeedbackRating: number;
  averageEffectivenessScore: number;
  
  // Category breakdown
  categoryDistribution: Record<PromptCategory, {
    generated: number;
    used: number;
    effectiveness: number;
  }>;
  
  // Impact metrics
  sessionImprovementScore?: number; // Measured learning outcome improvement
  studentEngagementImprovement?: number;
  discussionQualityImprovement?: number;
  
  // Time tracking
  averageResponseTime: number; // How quickly teacher responds to prompts
  sessionPhaseEffectiveness: Record<SessionPhase, number>;
  
  // Metadata
  analysisStartDate: Date;
  analysisEndDate: Date;
  dataPoints: number;
}

export interface GuidanceSystemMetrics {
  // System-wide metrics
  totalSessions: number;
  totalTeachers: number;
  totalPromptsGenerated: number;
  totalInteractions: number;
  
  // Effectiveness metrics
  overallUsageRate: number;
  overallSatisfactionRating: number;
  systemReliability: number; // Uptime/error rate
  
  // Performance metrics
  averagePromptGenerationTime: number;
  averageSystemResponseTime: number;
  peakConcurrentSessions: number;
  
  // Educational impact
  averageLearningImprovement: number;
  averageEngagementImprovement: number;
  teacherSatisfactionScore: number;
  
  // By subject/category
  subjectPerformance: Record<SubjectArea, {
    usage: number;
    effectiveness: number;
    satisfaction: number;
  }>;
  
  categoryPerformance: Record<PromptCategory, {
    usage: number;
    effectiveness: number;
    avgResponseTime: number;
  }>;
  
  // Reporting period
  reportingPeriodStart: Date;
  reportingPeriodEnd: Date;
  lastUpdated: Date;
}

// ============================================================================
// Database Schema Interfaces
// ============================================================================

export interface TeacherGuidanceMetricsTable {
  id: string;
  session_id: string;
  teacher_id: string;
  prompt_id: string;
  prompt_category: string;
  priority_level: string;
  generated_at: Date;
  acknowledged_at?: Date;
  used_at?: Date;
  dismissed_at?: Date;
  feedback_rating?: number;
  feedback_text?: string;
  effectiveness_score?: number;
  learning_outcome_improvement?: number;
  session_phase_impact?: string;
  created_at: Date;
  updated_at: Date;
}

export interface TeacherPromptEffectivenessTable {
  id: string;
  prompt_category: string;
  subject_area: string;
  session_phase: string;
  avg_effectiveness_score: number;
  total_generated: number;
  total_used: number;
  avg_feedback_rating: number;
  usage_rate: number;
  last_calculated: Date;
  data_points: number;
  created_at: Date;
  updated_at: Date;
}

export interface SessionGuidanceAnalyticsTable {
  id: string;
  session_id: string;
  teacher_id: string;
  school_id: string;
  total_prompts_generated: number;
  total_prompts_acknowledged: number;
  total_prompts_used: number;
  total_prompts_dismissed: number;
  acknowledgment_rate: number;
  usage_rate: number;
  avg_feedback_rating: number;
  avg_effectiveness_score: number;
  session_improvement_score?: number;
  student_engagement_improvement?: number;
  discussion_quality_improvement?: number;
  avg_response_time_seconds: number;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface GuidanceSystemConfig {
  prompts: {
    maxPerSession: number;
    expirationMinutes: number;
    cleanupIntervalMinutes: number;
    effectivenessScoreWeight: number;
  };
  
  features: {
    subjectAwarePrompts: boolean;
    phaseAwarePrompts: boolean;
    effectivenessTracking: boolean;
    realTimeGeneration: boolean;
    highPriorityAlerts: boolean;
    audioNotifications: boolean;
  };
  
  thresholds: {
    highPriorityScore: number;
    lowEffectivenessThreshold: number;
    rapidResponseTimeMs: number;
    sessionImprovementThreshold: number;
  };
  
  analytics: {
    retentionDays: number;
    aggregationIntervalHours: number;
    reportingEnabled: boolean;
    realTimeMetrics: boolean;
  };
}

// ============================================================================
// Utility Types
// ============================================================================

export type PromptStatus = 'active' | 'acknowledged' | 'used' | 'dismissed' | 'expired';

export type GuidanceEventType = 
  | 'prompt_generated'
  | 'prompt_acknowledged' 
  | 'prompt_used'
  | 'prompt_dismissed'
  | 'prompt_expired'
  | 'feedback_submitted'
  | 'session_analyzed';

// Helper type for partial updates
export type PartialTeacherPrompt = Partial<TeacherPrompt> & {
  id: string;
};

// Helper type for metrics aggregation
export type MetricsTimeframe = 'session' | 'daily' | 'weekly' | 'monthly' | 'all_time';

// Export utility functions interface
export interface GuidanceUtilities {
  calculateEffectivenessScore(category: PromptCategory, priority: PromptPriority, feedback?: number): number;
  determinePromptTiming(priority: PromptPriority, sessionPhase: SessionPhase): PromptTiming;
  generatePromptMessage(category: PromptCategory, context: any, subject: SubjectArea): string;
  validatePromptContext(context: any): boolean;
  formatPromptForDisplay(prompt: TeacherPrompt): string;
}
