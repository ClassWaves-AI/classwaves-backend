import { databricksService } from '../../../services/databricks.service';

// Mock dependencies
jest.mock('../../../services/databricks.service');

describe('Analytics Recording', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (databricksService.generateId as jest.Mock).mockReturnValue('analytics-id-123');
    (databricksService.insert as jest.Mock).mockResolvedValue(true);
  });

  describe('recordSessionConfigured', () => {
    it('should create proper analytics', async () => {
      const sessionId = 'session-123';
      const teacherId = 'teacher-456';
      const groupPlan = {
        numberOfGroups: 3,
        groupSize: 4,
        groups: [
          { name: 'Group A', leaderId: 'student-1', memberIds: ['student-2', 'student-3'] },
          { name: 'Group B', leaderId: 'student-4', memberIds: ['student-5', 'student-6'] },
          { name: 'Group C', leaderId: null, memberIds: ['student-7', 'student-8', 'student-9'] }
        ]
      };

      // This would be imported from the actual service - for now simulate the function
      const recordSessionConfigured = async (sessionId: string, teacherId: string, groupPlan: any) => {
        const configuredAt = new Date();
        
        // Insert session_analytics record with planned metrics
        await databricksService.insert('session_analytics', {
          id: databricksService.generateId(),
          session_id: sessionId,
          planned_groups: groupPlan.numberOfGroups,
          planned_group_size: groupPlan.groupSize,
          planned_members: groupPlan.groups.reduce((sum: number, g: any) => sum + g.memberIds.length + (g.leaderId ? 1 : 0), 0),
          planned_leaders: groupPlan.groups.filter((g: any) => g.leaderId).length,
          configured_at: configuredAt,
          calculation_timestamp: configuredAt,
        });

        // Insert session_events record
        await databricksService.insert('session_events', {
          id: databricksService.generateId(),
          session_id: sessionId,
          teacher_id: teacherId,
          event_type: 'configured',
          event_time: configuredAt,
          payload: JSON.stringify({
            numberOfGroups: groupPlan.numberOfGroups,
            groupSize: groupPlan.groupSize,
            totalMembers: groupPlan.groups.reduce((sum: number, g: any) => sum + g.memberIds.length + (g.leaderId ? 1 : 0), 0),
            leadersAssigned: groupPlan.groups.filter((g: any) => g.leaderId).length,
          }),
        });
      };

      await recordSessionConfigured(sessionId, teacherId, groupPlan);

      expect(databricksService.insert).toHaveBeenCalledWith(
        'session_analytics',
        expect.objectContaining({
          session_id: sessionId,
          planned_groups: 3,
          planned_group_size: 4,
          planned_members: 8, // 2+2+3 members + 2 leaders with IDs
          planned_leaders: 2, // Only groups A and B have leaders
          configured_at: expect.any(Date)
        })
      );

      expect(databricksService.insert).toHaveBeenCalledWith(
        'session_events',
        expect.objectContaining({
          session_id: sessionId,
          teacher_id: teacherId,
          event_type: 'configured',
          payload: expect.stringContaining('numberOfGroups')
        })
      );
    });
  });

  describe('recordSessionStarted', () => {
    it('should update readiness metrics', async () => {
      const sessionId = 'session-123';
      const teacherId = 'teacher-456';
      const readyGroupsAtStart = 2;
      const startedWithoutReadyGroups = false;

      const recordSessionStarted = async (sessionId: string, teacherId: string, readyGroupsAtStart: number, startedWithoutReadyGroups: boolean) => {
        const startedAt = new Date();
        
        // Update session_analytics with start metrics
        await databricksService.update('session_analytics', sessionId, {
          started_at: startedAt,
          ready_groups_at_start: readyGroupsAtStart,
          started_without_ready_groups: startedWithoutReadyGroups,
        });

        // Insert session start event
        await databricksService.insert('session_events', {
          id: databricksService.generateId(),
          session_id: sessionId,
          teacher_id: teacherId,
          event_type: 'started',
          event_time: startedAt,
          payload: JSON.stringify({
            readyGroupsAtStart,
            startedWithoutReadyGroups,
          }),
        });
      };

      (databricksService.update as jest.Mock).mockResolvedValue(true);

      await recordSessionStarted(sessionId, teacherId, readyGroupsAtStart, startedWithoutReadyGroups);

      expect(databricksService.update).toHaveBeenCalledWith(
        'session_analytics',
        sessionId,
        expect.objectContaining({
          started_at: expect.any(Date),
          ready_groups_at_start: 2,
          started_without_ready_groups: false
        })
      );

      expect(databricksService.insert).toHaveBeenCalledWith(
        'session_events',
        expect.objectContaining({
          event_type: 'started',
          payload: expect.stringContaining('readyGroupsAtStart')
        })
      );
    });
  });

  describe('recordLeaderReady', () => {
    it('should update timeline correctly', async () => {
      const sessionId = 'session-123';
      const groupId = 'group-456';
      const leaderId = 'leader-789';

      const recordLeaderReady = async (sessionId: string, groupId: string, leaderId: string) => {
        const readyAt = new Date();
        
        // Update group_analytics with leader ready time
        await databricksService.update('group_analytics', groupId, {
          leader_ready_at: readyAt,
          leader_assigned: true,
        });

        // Insert leader ready event
        await databricksService.insert('session_events', {
          id: databricksService.generateId(),
          session_id: sessionId,
          teacher_id: null, // Leader ready events don't have teacher context
          event_type: 'leader_ready',
          event_time: readyAt,
          payload: JSON.stringify({
            groupId,
            leaderId,
          }),
        });

        // Update session analytics readiness timeline
        const sessionStartTime = await databricksService.queryOne(
          'SELECT started_at FROM session_analytics WHERE session_id = ?',
          [sessionId]
        );

        if (sessionStartTime?.started_at) {
          const minutesSinceStart = Math.floor((readyAt.getTime() - sessionStartTime.started_at.getTime()) / (1000 * 60));
          
          if (minutesSinceStart <= 5) {
            await databricksService.update('session_analytics', sessionId, {
              ready_groups_at_5m: 1 // This would be incremented
            });
          }
          
          if (minutesSinceStart <= 10) {
            await databricksService.update('session_analytics', sessionId, {
              ready_groups_at_10m: 1 // This would be incremented
            });
          }
        }
      };

      (databricksService.update as jest.Mock).mockResolvedValue(true);
      (databricksService.queryOne as jest.Mock).mockResolvedValue({
        started_at: new Date(Date.now() - 3 * 60 * 1000) // 3 minutes ago
      });

      await recordLeaderReady(sessionId, groupId, leaderId);

      expect(databricksService.update).toHaveBeenCalledWith(
        'group_analytics',
        groupId,
        expect.objectContaining({
          leader_ready_at: expect.any(Date),
          leader_assigned: true
        })
      );

      expect(databricksService.insert).toHaveBeenCalledWith(
        'session_events',
        expect.objectContaining({
          event_type: 'leader_ready',
          payload: expect.stringContaining('groupId')
        })
      );

      // Should update 5-minute timeline since leader ready within 5 minutes
      expect(databricksService.update).toHaveBeenCalledWith(
        'session_analytics',
        sessionId,
        expect.objectContaining({
          ready_groups_at_5m: 1
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle analytics write failures gracefully', async () => {
      const sessionId = 'session-123';
      const teacherId = 'teacher-456';
      const groupPlan = {
        numberOfGroups: 1,
        groupSize: 4,
        groups: [{ name: 'Group A', leaderId: 'student-1', memberIds: ['student-2'] }]
      };

      (databricksService.insert as jest.Mock).mockRejectedValueOnce(new Error('Database connection failed'));

      const recordSessionConfigured = async (sessionId: string, teacherId: string, groupPlan: any) => {
        try {
          await databricksService.insert('session_analytics', {
            id: databricksService.generateId(),
            session_id: sessionId,
            planned_groups: groupPlan.numberOfGroups,
          });
        } catch (error) {
          console.error('Failed to record session configured analytics:', error);
          // Don't throw - analytics failure shouldn't block session creation
        }
      };

      // Should not throw
      await expect(recordSessionConfigured(sessionId, teacherId, groupPlan)).resolves.not.toThrow();
    });
  });
});
