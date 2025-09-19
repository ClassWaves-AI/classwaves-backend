import type { AIAnalysisPort } from '../services/ai-analysis.port';
import { DatabricksAIAnalysisAdapter } from '../adapters/ai-analysis.databricks';

let instance: AIAnalysisPort | null = null;

export function getAIAnalysisPort(): AIAnalysisPort {
  if (!instance) instance = new DatabricksAIAnalysisAdapter();
  return instance;
}

export const aiAnalysisPort: AIAnalysisPort = getAIAnalysisPort();

