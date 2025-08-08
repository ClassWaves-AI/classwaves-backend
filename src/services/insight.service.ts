import { v4 as uuidv4 } from 'uuid';
import { redisService } from './redis.service';

// Assume an NLP service is available for complex text analysis
// import { nlpService } from './nlp.service'; // Service not implemented yet 

interface AnalyzeGroupTranscriptionParams {
  text: string;
  session_id: string;
  group_id: string;
}

interface GroupInsight {
  id: string;
  session_id: string;
  group_id: string;
  type: 'conceptual_density' | 'topical_cohesion' | 'sentiment_arc' | 'argumentation_quality';
  message: string;
  severity: 'info' | 'warning' | 'success';
  timestamp: string;
  metadata?: Record<string, any>;
}

class InsightService {
  /**
   * Analyzes a segment of a group's transcription and generates real-time insights.
   * This is the entry point for Tier 1 group analysis.
   */
  async analyzeGroupTranscription(params: AnalyzeGroupTranscriptionParams): Promise<GroupInsight[]> {
    const { text, session_id, group_id } = params;
    const insights: GroupInsight[] = [];
    
    try {
      // Analyze for conceptual density
      const conceptualDensity = await nlpService.calculateConceptualDensity(text);
      if (conceptualDensity > 0.8) {
        insights.push({
          id: uuidv4(),
          session_id,
          group_id,
          type: 'conceptual_density',
          message: `Group is using sophisticated, topic-relevant language.`,
          severity: 'success',
          timestamp: new Date().toISOString(),
          metadata: { score: conceptualDensity }
        });
      }

      // Analyze for topical cohesion
      const topicalCohesion = await nlpService.calculateTopicalCohesion(text);
      if (topicalCohesion < 0.5) {
        insights.push({
          id: uuidv4(),
          session_id,
          group_id,
          type: 'topical_cohesion',
          message: `Group discussion may be drifting off-topic.`,
          severity: 'warning',
          timestamp: new Date().toISOString(),
          metadata: { score: topicalCohesion }
        });
      }

      // In a real implementation, you might buffer text segments to analyze sentiment arc
      // For this example, we'll keep it simple.

      // Store insights in Redis
      for (const insight of insights) {
        await this.storeInsight(session_id, insight);
      }

      return insights;
    } catch (error) {
      console.error('Group insight analysis error', error);
      return [];
    }
  }

  /**
   * Triggers a deep, Tier 2 analysis on a full group transcript.
   * This would be called periodically or on-demand, not on every transcription chunk.
   */
  async performDeepGroupAnalysis(sessionId: string, groupId: string, fullTranscript: string[]): Promise<void> {
    const transcriptText = fullTranscript.join('\n');
    
    const argumentationAnalysis = await nlpService.analyzeArgumentationQuality(transcriptText, []);
    
    const insight: GroupInsight = {
      id: uuidv4(),
      session_id: sessionId,
      group_id: groupId,
      type: 'argumentation_quality',
      message: `Group argumentation quality score: ${Math.round(argumentationAnalysis.score * 100)}/100.`,
      severity: 'info',
      timestamp: new Date().toISOString(),
      metadata: argumentationAnalysis
    };

    await this.storeInsight(sessionId, insight);
  }

  private async storeInsight(sessionId: string, insight: GroupInsight) {
    const insightKey = `insights:${sessionId}`;
    await redisService.getClient().lpush(insightKey, JSON.stringify(insight));
    // Set expiry to 24 hours to prevent memory leaks
    await redisService.getClient().expire(insightKey, 86400);
  }

  /**
   * Get session insights summary for a specific session.
   */
  async getSessionInsights(sessionId: string, limit = 50): Promise<GroupInsight[]> {
    try {
      const insightStrings = await redisService.getClient().lrange(`insights:${sessionId}`, 0, limit - 1);
      return insightStrings.map(str => JSON.parse(str));
    } catch (error) {
      console.error('Failed to get session insights', error);
      return [];
    }
  }

  /**
   * Clear all data for a session (e.g., when it ends).
   */
  async clearSessionData(sessionId: string): Promise<void> {
    await redisService.getClient().del(`insights:${sessionId}`);
  }
}

// Export singleton instance
export const insightService = new InsightService();

// Mock NLP service for demonstration purposes
const mockNlpService = {
  calculateConceptualDensity: async (text: string) => Math.random(),
  calculateTopicalCohesion: async (text: string) => Math.random(),
  analyzeArgumentationQuality: async (text: string, objectives: string[]) => ({
    score: Math.random(),
    claims: 1 + Math.floor(Math.random() * 5),
    evidence: 1 + Math.floor(Math.random() * 5),
  }),
};

// In a real app, this would be a proper implementation
const nlpService = mockNlpService;
