import { databricksService } from '../../../services/databricks.service';
import { databricksConfig } from '../../../config/databricks.config';

export async function markAllGroupsReady(sessionId: string): Promise<void> {
  await databricksService.query(
    `UPDATE ${databricksConfig.catalog}.sessions.student_groups
     SET is_ready = true
     WHERE session_id = ?`,
    [sessionId]
  );
}

