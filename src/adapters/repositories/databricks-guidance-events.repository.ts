import { databricksService } from '../../services/databricks.service';
import type { GuidanceEventsRepositoryPort, GuidanceEventRecord } from '../../services/ports/guidance-events.repository.port.ts';

class DatabricksGuidanceEventsRepository implements GuidanceEventsRepositoryPort {
  async insert(event: GuidanceEventRecord): Promise<void> {
    try {
      await databricksService.insert('guidance_events', {
        id: event.id,
        session_id: event.sessionId,
        group_id: event.groupId ?? null,
        type: event.type,
        payload_json: event.payloadJson,
        timestamp: event.timestamp,
        created_at: new Date(),
      });
    } catch (e) {
      // Non-blocking on persistence failure
      console.warn('⚠️ Failed to persist guidance event (non-blocking):', e instanceof Error ? e.message : String(e));
    }
  }
}

export const guidanceEventsRepository: GuidanceEventsRepositoryPort = new DatabricksGuidanceEventsRepository();

