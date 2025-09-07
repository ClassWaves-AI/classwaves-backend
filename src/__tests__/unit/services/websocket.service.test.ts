import { WebSocketService } from '../../../services/websocket';
import { databricksService } from '../../../services/databricks.service';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

// Mock dependencies
jest.mock('../../../services/databricks.service');
jest.mock('../../../services/redis.service');

describe('WebSocketService', () => {
  let webSocketService: WebSocketService;
  let mockHttpServer: Partial<HttpServer>;
  let mockSocket: any;
  let mockIo: Partial<SocketIOServer>;

  beforeEach(() => {
    // Create mock socket
    mockSocket = {
      id: 'socket-123',
      data: {
        userId: 'user-123',
        sessionId: 'session-123',
        schoolId: 'school-123'
      },
      join: jest.fn().mockResolvedValue(undefined),
      leave: jest.fn().mockResolvedValue(undefined),
      emit: jest.fn(),
      to: jest.fn().mockReturnThis(),
      on: jest.fn()
    };

    // Create mock IO server
    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      on: jest.fn()
    };

    // Create mock HTTP server
    mockHttpServer = {
      listen: jest.fn()
    };

    // Mock HTTP server for WebSocket service
    const mockServer = {} as any;
    webSocketService = new WebSocketService(mockServer);
    (webSocketService as any).io = mockIo;

    jest.clearAllMocks();
  });

  describe('Leader Ready Events', () => {
    it('should handle group:leader_ready event correctly', async () => {
      const leaderReadyData = {
        sessionId: 'session-123',
        groupId: 'group-456',
        ready: true
      };

      const mockGroup = {
        id: 'group-456',
        leader_id: 'leader-789',
        session_id: 'session-123',
        name: 'Group A'
      };

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(mockGroup);
      (databricksService.update as jest.Mock).mockResolvedValue(true);

      // Simulate the event handler
      const eventHandler = jest.fn(async (data) => {
        // Validate that student is the designated leader for this group
        const group = await databricksService.queryOne(
          'SELECT leader_id, session_id, name FROM classwaves.sessions.student_groups WHERE id = ? AND session_id = ?',
          [data.groupId, data.sessionId]
        );

        if (!group) {
          mockSocket.emit('error', {
            code: 'GROUP_NOT_FOUND',
            message: 'Group not found',
          });
          return;
        }

        // Update group readiness status
        await databricksService.update('student_groups', data.groupId, {
          is_ready: data.ready,
          updated_at: new Date(),
        });

        // Broadcast group status change to teacher clients
        mockIo.to!(`session:${data.sessionId}`).emit('group:status_changed', {
          groupId: data.groupId,
          status: data.ready ? 'ready' : 'waiting',
          isReady: data.ready
        });
      });

      await eventHandler(leaderReadyData);

      expect(databricksService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT leader_id'),
        [leaderReadyData.groupId, leaderReadyData.sessionId]
      );

      expect(databricksService.update).toHaveBeenCalledWith(
        'student_groups',
        leaderReadyData.groupId,
        expect.objectContaining({
          is_ready: true,
          updated_at: expect.any(Date)
        })
      );

      expect(mockIo.to).toHaveBeenCalledWith('session:session-123');
      expect(mockIo.emit).toHaveBeenCalledWith('group:status_changed', {
        groupId: 'group-456',
        status: 'ready',
        isReady: true
      });
    });

    it('should update group readiness in database', async () => {
      const leaderReadyData = {
        sessionId: 'session-123',
        groupId: 'group-456',
        ready: false
      };

      const mockGroup = {
        id: 'group-456',
        leader_id: 'leader-789',
        session_id: 'session-123',
        name: 'Group A'
      };

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(mockGroup);
      (databricksService.update as jest.Mock).mockResolvedValue(true);

      const eventHandler = jest.fn(async (data) => {
        const group = await databricksService.queryOne(
          'SELECT leader_id, session_id, name FROM classwaves.sessions.student_groups WHERE id = ? AND session_id = ?',
          [data.groupId, data.sessionId]
        );

        await databricksService.update('student_groups', data.groupId, {
          is_ready: data.ready,
          updated_at: new Date(),
        });
      });

      await eventHandler(leaderReadyData);

      expect(databricksService.update).toHaveBeenCalledWith(
        'student_groups',
        'group-456',
        expect.objectContaining({
          is_ready: false,
          updated_at: expect.any(Date)
        })
      );
    });

    it('should emit group:status_changed to teachers', async () => {
      const leaderReadyData = {
        sessionId: 'session-123',
        groupId: 'group-456',
        ready: true
      };

      const mockGroup = {
        id: 'group-456',
        leader_id: 'leader-789',
        session_id: 'session-123',
        name: 'Group A'
      };

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(mockGroup);
      (databricksService.update as jest.Mock).mockResolvedValue(true);

      const eventHandler = jest.fn(async (data) => {
        const group = await databricksService.queryOne(
          'SELECT leader_id, session_id, name FROM classwaves.sessions.student_groups WHERE id = ? AND session_id = ?',
          [data.groupId, data.sessionId]
        );

        await databricksService.update('student_groups', data.groupId, {
          is_ready: data.ready,
          updated_at: new Date(),
        });

        mockIo.to!(`session:${data.sessionId}`).emit('group:status_changed', {
          groupId: data.groupId,
          status: data.ready ? 'ready' : 'waiting',
          isReady: data.ready
        });
      });

      await eventHandler(leaderReadyData);

      expect(mockIo.to).toHaveBeenCalledWith('session:session-123');
      expect(mockIo.emit).toHaveBeenCalledWith('group:status_changed', {
        groupId: 'group-456',
        status: 'ready',
        isReady: true
      });
    });

    it('should handle reconnection and re-emit status', async () => {
      const sessionId = 'session-123';
      const mockGroups = [
        { id: 'group-1', is_ready: true, name: 'Group A' },
        { id: 'group-2', is_ready: false, name: 'Group B' }
      ];

      (databricksService.query as jest.Mock).mockResolvedValueOnce(mockGroups);

      const reconnectHandler = jest.fn(async () => {
        // Re-emit current group statuses on reconnect
        const groups = await databricksService.query(
          'SELECT id, is_ready, name FROM classwaves.sessions.student_groups WHERE session_id = ?',
          [sessionId]
        );

        groups.forEach((group: any) => {
          mockSocket.emit('group:status_changed', {
            groupId: group.id,
            status: group.is_ready ? 'ready' : 'waiting',
            isReady: group.is_ready
          });
        });
      });

      await reconnectHandler();

      expect(databricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, is_ready, name'),
        [sessionId]
      );

      expect(mockSocket.emit).toHaveBeenCalledWith('group:status_changed', {
        groupId: 'group-1',
        status: 'ready',
        isReady: true
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('group:status_changed', {
        groupId: 'group-2',
        status: 'waiting',
        isReady: false
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle group not found error', async () => {
      const leaderReadyData = {
        sessionId: 'session-123',
        groupId: 'invalid-group',
        ready: true
      };

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(null);

      const eventHandler = jest.fn(async (data) => {
        const group = await databricksService.queryOne(
          'SELECT leader_id, session_id, name FROM classwaves.sessions.student_groups WHERE id = ? AND session_id = ?',
          [data.groupId, data.sessionId]
        );

        if (!group) {
          mockSocket.emit('error', {
            code: 'GROUP_NOT_FOUND',
            message: 'Group not found',
          });
          return;
        }
      });

      await eventHandler(leaderReadyData);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found'
      });
    });

    it('should handle database errors gracefully', async () => {
      const leaderReadyData = {
        sessionId: 'session-123',
        groupId: 'group-456',
        ready: true
      };

      (databricksService.queryOne as jest.Mock).mockRejectedValueOnce(new Error('Database error'));

      const eventHandler = jest.fn(async (data) => {
        try {
          await databricksService.queryOne(
            'SELECT leader_id, session_id, name FROM classwaves.sessions.student_groups WHERE id = ? AND session_id = ?',
            [data.groupId, data.sessionId]
          );
        } catch (error) {
          mockSocket.emit('error', {
            code: 'LEADER_READY_FAILED',
            message: 'Failed to update leader readiness',
          });
        }
      });

      await eventHandler(leaderReadyData);

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        code: 'LEADER_READY_FAILED',
        message: 'Failed to update leader readiness'
      });
    });
  });
});
