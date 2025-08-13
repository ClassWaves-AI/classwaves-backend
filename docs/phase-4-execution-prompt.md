# ClassWaves Phase 4 Execution Prompt
## AI Analysis & Teacher Guidance System Implementation

**🎯 Mission**: Transform raw transcripts into actionable educational insights with intelligent teacher guidance  
**📋 Checklist**: Use `checkpoints/phase 4/ai-analysis-teacher-guidance-checklist.md` for task tracking  
**🔒 Compliance**: FERPA/COPPA compliant, zero-disk audio processing, comprehensive audit logging  

---

## 🛡️ **MANDATORY COMPLIANCE & SECURITY FOUNDATION**

### **Before Every Task - Security Checklist:**
- [ ] **FERPA Compliance**: All student data access includes educational purpose justification
- [ ] **COPPA Compliance**: No individual student identification (group-level analysis only)
- [ ] **Zero Disk Storage**: Audio processing strictly in-memory with immediate cleanup
- [ ] **Audit Logging**: Every database operation logs to `audit_log` table with actor, target, timestamp
- [ ] **Input Validation**: All APIs use Zod schemas for comprehensive input validation
- [ ] **Rate Limiting**: 100 requests per 15 minutes per IP with exponential backoff
- [ ] **TypeScript Strict**: 100% TypeScript with strict mode, no `any` types
- [ ] **Authentication**: Every endpoint requires authentication middleware
- [ ] **Parameterized Queries**: No SQL injection vulnerabilities

### **Environment Security Setup:**
```bash
# Add to .env (server-only, never client-exposed)
AI_TIER1_ENDPOINT=/serving-endpoints/classwaves-tier1-group-analysis/invocations
AI_TIER2_ENDPOINT=/serving-endpoints/classwaves-tier2-deep-analysis/invocations
AI_TIER1_TIMEOUT_MS=2000
AI_TIER2_TIMEOUT_MS=5000
TEACHER_PROMPT_MAX_PER_SESSION=15
TEACHER_ALERT_HIGH_PRIORITY_SOUND=true
TEACHER_PROMPT_BATCH_INTERVAL_MS=30000
TEACHER_GUIDANCE_ENABLED=true
TEACHER_PROMPT_SUBJECT_AWARE=true
TEACHER_ALERT_AUTO_EXPIRE_MS=120000
```

---

## 🏗️ **ARCHITECTURE & WORKFLOW ENFORCEMENT**

### **Feature-Based Architecture Requirements:**
```
classwaves-backend/src/
├── controllers/
│   ├── ai-analysis.controller.ts          ✅ COMPLETE
│   └── guidance-analytics.controller.ts   ❌ PHASE B
├── services/
│   ├── databricks-ai.service.ts          ✅ COMPLETE
│   ├── ai-analysis-buffer.service.ts     ❌ PHASE A Task 4
│   ├── teacher-prompt.service.ts         ❌ PHASE A Task 5
│   ├── alert-prioritization.service.ts   ❌ PHASE B Task 10
│   └── recommendation-engine.service.ts  ❌ PHASE B Task 11
├── routes/
│   ├── ai-analysis.routes.ts             ❌ PHASE A Task 7
│   └── guidance-analytics.routes.ts      ❌ PHASE B Task 14
├── types/
│   ├── ai-analysis.types.ts              ✅ COMPLETE
│   └── teacher-guidance.types.ts         ❌ PHASE A Task 6
└── scripts/
    └── create-guidance-schema.ts          ❌ PHASE A Task 6

classwaves-frontend/src/features/teacher-guidance/
├── api/           # React Query hooks for guidance APIs
├── components/    # AlertBanner, GuidanceSidebar, InsightsDashboard
├── hooks/         # use-teacher-guidance, use-prompt-acknowledgment
├── stores/        # teacher-guidance-store (Zustand)
├── types/         # Frontend guidance types
├── utils/         # prompt-feedback-tracker
└── __tests__/     # Comprehensive test suite (80%+ coverage)
```

### **Git Branching Compliance:**
```bash
# ENFORCED WORKFLOW - Never create features from master
git checkout release/mvp  # Always branch from release
git checkout -b feature/phase4-task-X-[task-name]
# Work on feature
git add . && git commit -m "feat(ai): implement [specific task]"
# Merge: feature → release → master (after QA)
```

---

## 📋 **PHASE A: CORE AI SERVICES EXECUTION (Week 1)**

### **Task 4: AI Analysis Buffering Service** 
**File**: `src/services/ai-analysis-buffer.service.ts`

**Implementation Requirements:**
```typescript
// ✅ COMPLIANCE: In-memory only, zero disk storage
import { z } from 'zod';
import { auditLog } from '../utils/audit-logger';

const transcriptionSchema = z.object({
  groupId: z.string().uuid(),
  sessionId: z.string().uuid(),
  transcription: z.string().min(1).max(10000),
  timestamp: z.date()
});

class AIAnalysisBufferService {
  private tier1Buffers = new Map<string, TranscriptBuffer>();
  private tier2Buffers = new Map<string, TranscriptBuffer>();
  
  async bufferTranscription(
    groupId: string, 
    sessionId: string, 
    transcription: string
  ): Promise<void> {
    // ✅ SECURITY: Input validation
    const validated = transcriptionSchema.parse({
      groupId, sessionId, transcription, timestamp: new Date()
    });
    
    // ✅ COMPLIANCE: Audit logging for educational data processing
    await auditLog({
      eventType: 'ai_analysis_buffer',
      actorId: 'system',
      targetType: 'group_transcription',
      targetId: groupId,
      educationalPurpose: 'Buffer transcripts for AI analysis to provide educational insights',
      complianceBasis: 'legitimate_educational_interest',
      sessionId
    });
    
    // Implementation logic with memory management
    // Force cleanup after processing
    if (global.gc) global.gc();
  }
}

export const aiAnalysisBufferService = new AIAnalysisBufferService();
```

**Quality Gates:**
- [ ] TypeScript strict compilation successful
- [ ] Zod schema validation for all inputs
- [ ] Audit logging for all buffer operations
- [ ] Memory cleanup after processing
- [ ] Unit tests with 80%+ coverage
- [ ] Integration test with WebSocket transcription pipeline

### **Task 5: Teacher Prompt Service**
**File**: `src/services/teacher-prompt.service.ts`

**Implementation Requirements:**
```typescript
// ✅ COMPLIANCE: Group-level analysis only (no individual student identification)
import { z } from 'zod';
import type { Tier1Insights, Tier2Insights } from '../types/ai-analysis.types';

const promptContextSchema = z.object({
  sessionPhase: z.enum(['opening', 'development', 'synthesis', 'closure']),
  subject: z.enum(['math', 'science', 'literature', 'history', 'general']),
  learningObjectives: z.array(z.string()).max(5),
  groupSize: z.number().min(1).max(8),
  sessionDuration: z.number().min(1) // minutes
});

export interface TeacherPrompt {
  id: string;
  category: 'facilitation' | 'deepening' | 'redirection' | 'collaboration' | 'assessment' | 'energy' | 'clarity';
  priority: 'high' | 'medium' | 'low';
  message: string;
  context: string;
  suggestedTiming: 'immediate' | 'next_break' | 'session_end';
  effectiveness_score?: number;
}

class TeacherPromptService {
  async generatePrompts(
    insights: Tier1Insights | Tier2Insights,
    context: z.infer<typeof promptContextSchema>
  ): Promise<TeacherPrompt[]> {
    // ✅ SECURITY: Input validation
    const validatedContext = promptContextSchema.parse(context);
    
    // ✅ COMPLIANCE: Audit logging for AI-generated teacher guidance
    await auditLog({
      eventType: 'teacher_prompt_generation',
      actorId: 'system',
      targetType: 'teacher_guidance',
      targetId: `session_${context.sessionId}`,
      educationalPurpose: 'Generate contextual teaching prompts to improve group discussion quality',
      complianceBasis: 'legitimate_educational_interest'
    });
    
    // Implementation with subject-specific and phase-aware logic
  }
}

export const teacherPromptService = new TeacherPromptService();
```

**Quality Gates:**
- [ ] Group-level analysis only (COPPA compliance)
- [ ] Subject-specific prompt generation
- [ ] Session phase awareness
- [ ] Effectiveness scoring mechanism
- [ ] Rate limiting (max 15 prompts per session)
- [ ] Unit tests for all prompt categories

### **Task 6: Teacher Guidance Database Schema**
**File**: `src/scripts/create-guidance-schema.ts`

**Implementation Requirements:**
```typescript
// ✅ DATABRICKS: Primary database for all persistent data
import { databricks } from '../config/databricks.config';

export async function createGuidanceSchema(): Promise<void> {
  // ✅ COMPLIANCE: Audit logging for schema changes
  await auditLog({
    eventType: 'schema_creation',
    actorId: 'system',
    targetType: 'database_schema',
    targetId: 'teacher_guidance_metrics',
    educationalPurpose: 'Create tables for tracking teacher guidance system effectiveness',
    complianceBasis: 'system_administration'
  });

  // ✅ SECURITY: Parameterized queries only
  const createTables = [
    `CREATE TABLE IF NOT EXISTS classwaves.ai_insights.teacher_guidance_metrics (
      id STRING NOT NULL,
      session_id STRING NOT NULL,
      teacher_id STRING NOT NULL,
      prompt_id STRING NOT NULL,
      prompt_category STRING NOT NULL,
      priority_level STRING NOT NULL,
      generated_at TIMESTAMP NOT NULL,
      acknowledged_at TIMESTAMP,
      used_at TIMESTAMP,
      dismissed_at TIMESTAMP,
      feedback_rating INT,
      feedback_text STRING,
      effectiveness_score DOUBLE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
    ) USING DELTA
    PARTITIONED BY (DATE(generated_at))
    TBLPROPERTIES ('delta.autoOptimize.optimizeWrite' = 'true')`,
    
    // Additional tables with proper indexing and partitioning
  ];

  for (const query of createTables) {
    await databricks.query(query);
  }
}
```

**Quality Gates:**
- [ ] Databricks Delta Lake tables with proper partitioning
- [ ] Foreign key constraints and indexes
- [ ] GDPR-compliant data retention policies
- [ ] Audit logging for schema operations
- [ ] Test script execution in development environment

### **Task 7: AI Analysis Routes**
**File**: `src/routes/ai-analysis.routes.ts`

**Implementation Requirements:**
```typescript
// ✅ SECURITY: Authentication, rate limiting, input validation
import express from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.middleware';
import { validateInput } from '../middleware/validation.middleware';
import * as aiController from '../controllers/ai-analysis.controller';

const router = express.Router();

// ✅ SECURITY: Rate limiting (100 requests per 15 minutes)
const aiAnalysisLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many AI analysis requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// ✅ SECURITY: All routes require authentication
router.use(authenticate);
router.use(aiAnalysisLimiter);

// ✅ SECURITY: Input validation with Zod schemas
router.post('/analyze-discussion', 
  validateInput(aiController.analyzeDiscussionSchema),
  aiController.analyzeGroupDiscussion
);

router.post('/generate-insights',
  validateInput(aiController.generateInsightsSchema),
  aiController.generateDeepInsights
);

// Additional routes with proper middleware stack
export default router;
```

**Quality Gates:**
- [ ] Authentication middleware on all routes
- [ ] Rate limiting with educational-appropriate limits
- [ ] Comprehensive input validation
- [ ] CORS configuration with strict origins
- [ ] Security headers (helmet)
- [ ] Integration tests for all endpoints

---

## 📋 **PHASE B: INTEGRATION & REAL-TIME EXECUTION (Week 2)**

### **Real-time Integration Pattern:**
```typescript
// ✅ WEBSOCKET: Real-time AI insights with proper error handling
import { WebSocketService } from '../services/websocket.service';

// Integration with existing transcription pipeline
export async function integrateAIWithTranscription() {
  websocketService.on('transcription:group:new', async (data) => {
    try {
      // ✅ COMPLIANCE: Group-level processing only
      await aiAnalysisBufferService.bufferTranscription(
        data.groupId, 
        data.sessionId, 
        data.transcription
      );
      
      // ✅ REAL-TIME: Emit AI insights via WebSocket
      const insights = await databricksAIService.analyzeTier1(/* params */);
      websocketService.emitToSession(data.sessionId, 'group:tier1:insight', insights);
      
    } catch (error) {
      // ✅ ERROR HANDLING: Graceful degradation
      logger.error('AI analysis failed', { error, groupId: data.groupId });
    }
  });
}
```

### **Analytics Tracking Implementation:**
```typescript
// ✅ ANALYTICS: Comprehensive prompt effectiveness tracking
export async function trackPromptInteraction(
  promptId: string,
  interactionType: 'acknowledged' | 'used' | 'dismissed',
  feedback?: { rating: number; text: string }
): Promise<void> {
  // ✅ COMPLIANCE: Audit logging for teacher interaction data
  await auditLog({
    eventType: 'prompt_interaction',
    actorId: teacherId,
    targetType: 'teacher_prompt',
    targetId: promptId,
    educationalPurpose: 'Track teacher engagement with AI-generated guidance for system improvement',
    complianceBasis: 'legitimate_educational_interest'
  });
  
  // ✅ DATABRICKS: Store interaction data for analytics
  await databricks.query(`
    UPDATE classwaves.ai_insights.teacher_guidance_metrics 
    SET ${interactionType}_at = CURRENT_TIMESTAMP(),
        feedback_rating = ?,
        feedback_text = ?,
        updated_at = CURRENT_TIMESTAMP()
    WHERE id = ?
  `, [feedback?.rating, feedback?.text, promptId]);
}
```

---

## 📋 **PHASE C: FRONTEND & TESTING EXECUTION (Week 3)**

### **Frontend Architecture Requirements:**
```typescript
// ✅ FEATURE-BASED: Organized by feature with proper imports
// classwaves-frontend/src/features/teacher-guidance/components/AlertBanner.tsx

import { z } from 'zod';
import { useTeacherGuidance } from '../hooks/use-teacher-guidance';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

const alertInteractionSchema = z.object({
  promptId: z.string().uuid(),
  action: z.enum(['acknowledge', 'use', 'dismiss']),
  feedback: z.object({
    rating: z.number().min(1).max(5),
    text: z.string().max(500)
  }).optional()
});

export function AlertBanner() {
  const { highPriorityAlerts, acknowledgePrompt } = useTeacherGuidance();
  
  const handleInteraction = async (promptId: string, action: string) => {
    // ✅ SECURITY: Client-side validation
    const validated = alertInteractionSchema.parse({
      promptId,
      action,
      // feedback if provided
    });
    
    // ✅ ANALYTICS: Track all teacher interactions
    await acknowledgePrompt(validated);
  };
  
  // ✅ ACCESSIBILITY: Proper ARIA labels and keyboard navigation
  return (
    <div role="alert" aria-live="polite">
      {/* Implementation with proper error boundaries */}
    </div>
  );
}
```

### **Testing Requirements (80%+ Coverage):**
```typescript
// ✅ TESTING: Comprehensive test suite
// __tests__/ai-analysis-buffer.service.test.ts

import { aiAnalysisBufferService } from '../ai-analysis-buffer.service';
import { auditLog } from '../utils/audit-logger';

jest.mock('../utils/audit-logger');

describe('AIAnalysisBufferService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('bufferTranscription', () => {
    it('should validate input and log audit trail', async () => {
      // ✅ SECURITY TESTING: Input validation
      await expect(
        aiAnalysisBufferService.bufferTranscription('', 'invalid', 'text')
      ).rejects.toThrow('Invalid UUID');
      
      // ✅ COMPLIANCE TESTING: Audit logging
      await aiAnalysisBufferService.bufferTranscription(
        'valid-uuid',
        'valid-session-uuid',
        'test transcription'
      );
      
      expect(auditLog).toHaveBeenCalledWith({
        eventType: 'ai_analysis_buffer',
        educationalPurpose: expect.stringContaining('educational insights')
      });
    });
    
    // ✅ PERFORMANCE TESTING: Memory cleanup
    it('should trigger garbage collection after processing', async () => {
      const gcSpy = jest.spyOn(global, 'gc').mockImplementation();
      
      await aiAnalysisBufferService.bufferTranscription(/* params */);
      
      expect(gcSpy).toHaveBeenCalled();
    });
  });
});
```

### **E2E Testing Strategy:**
```typescript
// ✅ E2E: Critical user journeys only
// tests/e2e/teacher-guidance-flow.spec.ts

import { test, expect } from '@playwright/test';

test.describe('Teacher Guidance System', () => {
  test.beforeEach(async ({ page }) => {
    // ✅ AUTHENTICATION: Use proper auth setup
    await page.goto('/dashboard/sessions/active');
    await expect(page.locator('[data-testid="session-active"]')).toBeVisible();
  });

  test('should display real-time AI insights and prompts', async ({ page }) => {
    // ✅ REAL-TIME TESTING: WebSocket functionality
    await page.locator('[data-testid="start-transcription"]').click();
    
    // Wait for AI insights to appear
    await expect(page.locator('[data-testid="tier1-insights"]')).toBeVisible({ timeout: 5000 });
    
    // ✅ COMPLIANCE TESTING: Verify group-level analysis only
    await expect(page.locator('[data-testid="individual-student-data"]')).not.toBeVisible();
    
    // ✅ TEACHER GUIDANCE: Prompt acknowledgment flow
    await page.locator('[data-testid="acknowledge-prompt"]').click();
    await expect(page.locator('[data-testid="prompt-acknowledged"]')).toBeVisible();
  });
});
```

---

## 🎯 **QUALITY GATES & SUCCESS VALIDATION**

### **Code Quality Enforcement:**
```bash
# ✅ REQUIRED: All quality gates must pass
npm run lint                    # ESLint: 0 errors, 0 warnings
npm run type-check             # TypeScript: Strict compilation
npm run test:coverage          # Tests: 80%+ coverage
npm run build                  # Build: Successful compilation
npm audit                      # Security: Clean audit
npm run e2e:ci                 # E2E: All tests passing
```

### **Performance Validation:**
```typescript
// ✅ PERFORMANCE: Latency requirements
const performanceTests = {
  tier1Analysis: { maxLatency: 2000, target: 'group analysis' },
  tier2Analysis: { maxLatency: 5000, target: 'deep insights' },
  promptGeneration: { maxLatency: 3000, target: 'teacher prompts' },
  websocketDelivery: { maxLatency: 1000, target: 'real-time updates' }
};

// ✅ SCALABILITY: Load testing
const loadTests = {
  concurrentSessions: 50,
  transcriptionsPerSecond: 100,
  aiAnalysisPerMinute: 1000,
  promptsPerSession: 15
};
```

### **Business Success Metrics:**
```typescript
// ✅ SUCCESS CRITERIA: Measurable outcomes
const successMetrics = {
  promptAcknowledgmentRate: { target: 85, unit: 'percent' },
  actionTakenRate: { target: 70, unit: 'percent' },
  sessionImprovementScore: { target: 15, unit: 'percent' },
  teacherSatisfaction: { target: 4.0, unit: 'out_of_5' },
  falsePositiveAlerts: { target: 2, unit: 'per_session' },
  systemUptime: { target: 95, unit: 'percent' }
};
```

---

## 🚀 **DEPLOYMENT & HANDOFF PREPARATION**

### **Production Readiness Checklist:**
- [ ] **Security**: Penetration testing completed
- [ ] **Compliance**: FERPA/COPPA audit passed
- [ ] **Performance**: Load testing validated (50+ concurrent sessions)
- [ ] **Monitoring**: Error tracking and alerting configured
- [ ] **Documentation**: API docs, deployment runbook complete
- [ ] **Training**: Teacher user guide and training materials ready

### **Deployment Strategy:**
```bash
# ✅ ZERO-DOWNTIME: Rolling deployment
# 1. Deploy to staging environment
# 2. Run full regression tests
# 3. Deploy database schema changes
# 4. Deploy backend services (blue-green)
# 5. Deploy frontend updates
# 6. Monitor system health and rollback if needed
```

---

## 📖 **EXECUTION SUMMARY**

**This prompt ensures:**
1. **Security First**: Every implementation follows FERPA/COPPA compliance
2. **Quality Assurance**: 80%+ test coverage, TypeScript strict mode
3. **Architecture Compliance**: Feature-based structure, proper imports
4. **Performance Standards**: Latency targets, scalability requirements
5. **Business Success**: Measurable outcomes and user satisfaction
6. **Production Ready**: Comprehensive testing and deployment procedures

**🎯 Follow this prompt systematically to deliver a production-ready, compliant, and effective AI analysis system that transforms ClassWaves into a powerful educational platform.**
