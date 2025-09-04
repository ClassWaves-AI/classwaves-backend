import { Response } from 'express';
import { databricksService } from '../services/databricks.service';
import { KioskAuthRequest } from '../middleware/kiosk.auth.middleware';
import { getNamespacedWebSocketService } from '../services/websocket/namespaced-websocket.service';

export async function updateGroupStatus(req: KioskAuthRequest, res: Response): Promise<Response> {
  const { groupId } = req.params;
  const { isReady } = req.body;

  try {
    const kioskInfo = req.kiosk!;

    await databricksService.update('student_groups', kioskInfo.groupId, {
      is_ready: isReady,
      updated_at: new Date(),
    });
    
    // Get session info for WebSocket broadcast
    const group = await databricksService.queryOne(`
      SELECT session_id, name FROM classwaves.sessions.student_groups WHERE id = ?
    `, [groupId]);
    
    if (group) {
      // Emit WebSocket event to teacher dashboard via namespaced sessions service
      const nsSessions = getNamespacedWebSocketService()?.getSessionsService();
      if (nsSessions) {
        nsSessions.emitToSession(group.session_id, 'group:status_changed', {
          groupId,
          status: isReady ? 'ready' : 'waiting',
          isReady
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Group ${groupId} status updated successfully.`,
      data: { groupId, isReady }
    });

  } catch (error) {
    console.error(`Failed to update status for group ${groupId}:`, error);
    return res.status(500).json({
      error: 'STATUS_UPDATE_FAILED',
      message: 'An internal error occurred while updating the group status.',
    });
  }
}
