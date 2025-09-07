import type { AIAnalysisPort } from '../services/ai-analysis.port';
import type { Tier1Options, Tier1Insights, Tier2Options, Tier2Insights } from '../types/ai-analysis.types';

export class DatabricksAIAnalysisAdapter implements AIAnalysisPort {
  async analyzeTier1(groupTranscripts: string[], options: Tier1Options): Promise<Tier1Insights> {
    const { databricksAIService } = await import('../services/databricks-ai.service');
    return databricksAIService.analyzeTier1(groupTranscripts, options);
  }
  async analyzeTier2(sessionTranscripts: string[], options: Tier2Options): Promise<Tier2Insights> {
    const { databricksAIService } = await import('../services/databricks-ai.service');
    return databricksAIService.analyzeTier2(sessionTranscripts, options);
  }
}

export const databricksAIAnalysisAdapter = new DatabricksAIAnalysisAdapter();

