import { getCompositionRoot } from '../app/composition-root';
import type { GuidanceEventType } from './ports/guidance-events.repository.port';

class GuidanceEventsService {
  async record(params: { sessionId: string; groupId?: string | null; type: GuidanceEventType; payload: any; timestamp?: Date }): Promise<void> {
    try {
      const repo = getCompositionRoot().getGuidanceEventsRepository();
      const id = (await import('./databricks.service')).databricksService.generateId();
      await repo.insert({
        id,
        sessionId: params.sessionId,
        groupId: params.groupId ?? null,
        type: params.type,
        payloadJson: JSON.stringify(params.payload),
        timestamp: params.timestamp ?? new Date(),
      });
    } catch { /* intentionally ignored: best effort cleanup */ }
  }
}

export const guidanceEventsService = new GuidanceEventsService();

