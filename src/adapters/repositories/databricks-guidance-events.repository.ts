import { databricksService } from '../../services/databricks.service';
import type { GuidanceEventsRepositoryPort, GuidanceEventRecord } from '../../services/ports/guidance-events.repository.port.ts';
import { logger } from '../../utils/logger';

class DatabricksGuidanceEventsRepository implements GuidanceEventsRepositoryPort {
  async insert(event: GuidanceEventRecord): Promise<void> {
    try {
      // Align with live schema: event_type, event_time, payload
      await databricksService.insert('guidance_events', {
        id: event.id,
        session_id: event.sessionId,
        group_id: event.groupId ?? null,
        event_type: event.type,
        payload: event.payloadJson,
        event_timestamp: event.timestamp,
        created_at: new Date(),
      });
    } catch (e) {
      // Non-blocking on persistence failure
      logger.warn('⚠️ Failed to persist guidance event (non-blocking):', e instanceof Error ? e.message : String(e));
    }
  }
}

export const guidanceEventsRepository: GuidanceEventsRepositoryPort = new DatabricksGuidanceEventsRepository();