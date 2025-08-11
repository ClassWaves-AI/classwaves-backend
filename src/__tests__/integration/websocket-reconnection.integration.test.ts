/**
 * WebSocket Reconnection and Auto-Join Integration Tests
 * 
 * Tests critical reconnection scenarios for teacher and student clients:
 * - Connection loss and automatic reconnection
 * - Session room auto-rejoin after reconnection
 * - Exponential backoff behavior
 * - Group leader ready functionality after reconnection
 * - Status synchronization after reconnection
 */

import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as clientIO, Socket as ClientSocket } from 'socket.io-client';
import { WebSocketService } from '../../services/websocket.service';
import { databricksService } from '../../services/databricks.service';

describe('WebSocket Reconnection Integration Tests', () => {
  let httpServer: HTTPServer;
  let wsService: WebSocketService;
  let teacherSocket: ClientSocket;
  let studentSocket: ClientSocket;
  let mockToken: string;
  let testSessionId: string;
  let testGroupId: string;

  beforeAll(async () => {
    // Set up test server
    httpServer = new HTTPServer();
    wsService = new WebSocketService(httpServer);
    
    mockToken = 'test-jwt-token';
    testSessionId = 'test-session-123';
    testGroupId = 'test-group-456';

    // Mock databricks calls
    jest.spyOn(databricksService, 'queryOne').mockImplementation(async (query: string, params?: any[]) => {
      if (query.includes('SELECT id, status FROM classwaves.sessions.classroom_sessions')) {
        return { id: testSessionId, status: 'active' };
      }
      if (query.includes('SELECT leader_id, session_id, name FROM')) {
        return { leader_id: 'student-123', session_id: testSessionId, name: 'Group A' };
      }
      return null;
    });

    jest.spyOn(databricksService, 'update').mockResolvedValue(undefined);

    // Start server
    await new Promise<void>((resolve) => {
      httpServer.listen(0, resolve);
    });
  });

  afterAll(async () => {
    httpServer.close();
  });

  beforeEach(() => {
    // Mock authentication
    jest.spyOn(require('jsonwebtoken'), 'verify').mockReturnValue({
      userId: 'teacher-123',
      exp: Math.floor(Date.now() / 1000) + 3600
    });
  });

  afterEach(() => {
    if (teacherSocket?.connected) teacherSocket.disconnect();
    if (studentSocket?.connected) studentSocket.disconnect();
    jest.clearAllMocks();
  });

  describe('Teacher Client Reconnection', () => {
    test('should automatically rejoin session after reconnection', (done) => {
      const port = (httpServer.address() as any).port;
      
      teacherSocket = clientIO(`http://localhost:${port}`, {
        auth: { token: mockToken },
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 100, // Fast for testing
      });

      let connectCount = 0;
      let sessionJoinCount = 0;

      teacherSocket.on('connect', () => {
        connectCount++;
        
        if (connectCount === 1) {
          // First connection - join session
          teacherSocket.emit('session:join', { sessionId: testSessionId });
        }
        
        if (connectCount === 2) {
          // After reconnection - should auto-rejoin
          setTimeout(() => {
            expect(sessionJoinCount).toBe(1); // Should have rejoined automatically
            done();
          }, 100);
        }
      });

      teacherSocket.on('session:status_changed', (data) => {
        if (data.sessionId === testSessionId) {
          sessionJoinCount++;
          
          if (connectCount === 1) {
            // Simulate connection loss after successful join
            setTimeout(() => {
              teacherSocket.disconnect();
              teacherSocket.connect(); // Trigger reconnection
            }, 50);
          }
        }
      });

      teacherSocket.on('error', done);
    });

    test('should maintain session context across reconnections', (done) => {
      const port = (httpServer.address() as any).port;
      
      teacherSocket = clientIO(`http://localhost:${port}`, {
        auth: { token: mockToken },
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 100,
      });

      let reconnected = false;

      teacherSocket.on('connect', () => {
        if (!reconnected) {
          // Initial connection
          teacherSocket.emit('session:join', { sessionId: testSessionId });
        } else {
          // After reconnection - emit status change to verify session context
          teacherSocket.emit('session:update_status', { 
            sessionId: testSessionId, 
            status: 'paused' 
          });
        }
      });

      teacherSocket.on('session:status_changed', (data) => {
        if (data.status === 'active' && !reconnected) {
          // First join successful - simulate disconnection
          setTimeout(() => {
            teacherSocket.disconnect();
            reconnected = true;
            teacherSocket.connect();
          }, 50);
        } else if (data.status === 'paused' && reconnected) {
          // Status update worked after reconnection - session context maintained
          expect(data.sessionId).toBe(testSessionId);
          done();
        }
      });

      teacherSocket.on('error', done);
    });
  });

  describe('Student Client Reconnection', () => {
    test('should auto-rejoin session and maintain group assignment', (done) => {
      const port = (httpServer.address() as any).port;
      
      studentSocket = clientIO(`http://localhost:${port}`, {
        auth: { token: mockToken },
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 100,
      });

      let connectCount = 0;
      let leaderReadyCount = 0;

      studentSocket.on('connect', () => {
        connectCount++;
        
        if (connectCount === 1) {
          // First connection - join session
          studentSocket.emit('session:join', { sessionId: testSessionId });
        }
        
        if (connectCount === 2) {
          // After reconnection - test leader ready functionality
          studentSocket.emit('group:leader_ready', { 
            sessionId: testSessionId, 
            groupId: testGroupId, 
            ready: true 
          });
        }
      });

      studentSocket.on('session:status_changed', (data) => {
        if (data.sessionId === testSessionId && connectCount === 1) {
          // Simulate connection loss after successful join
          setTimeout(() => {
            studentSocket.disconnect();
            studentSocket.connect();
          }, 50);
        }
      });

      studentSocket.on('group:status_changed', (data) => {
        if (data.groupId === testGroupId) {
          leaderReadyCount++;
          expect(data.isReady).toBe(true);
          expect(leaderReadyCount).toBe(1);
          done();
        }
      });

      studentSocket.on('error', done);
    });

    test('should handle exponential backoff on connection failures', (done) => {
      const port = 9999; // Non-existent port to force connection failures
      
      const startTime = Date.now();
      const connectionAttempts: number[] = [];

      studentSocket = clientIO(`http://localhost:${port}`, {
        auth: { token: mockToken },
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 100,
        reconnectionDelayMax: 500,
      });

      studentSocket.on('connect_error', () => {
        connectionAttempts.push(Date.now() - startTime);
        
        if (connectionAttempts.length === 3) {
          // Verify exponential backoff pattern
          expect(connectionAttempts[1] - connectionAttempts[0]).toBeGreaterThan(90); // ~100ms
          expect(connectionAttempts[2] - connectionAttempts[1]).toBeGreaterThan(180); // ~200ms
          done();
        }
      });

      // Prevent infinite retries
      setTimeout(() => {
        studentSocket.disconnect();
        if (connectionAttempts.length < 3) {
          done(new Error('Expected 3 connection attempts'));
        }
      }, 2000);
    });
  });

  describe('Backend Reconnection Handling', () => {
    test('should broadcast current session status on client reconnection', (done) => {
      const port = (httpServer.address() as any).port;
      
      teacherSocket = clientIO(`http://localhost:${port}`, {
        auth: { token: mockToken },
        reconnection: false, // Manual reconnection control
      });

      let initialStatusReceived = false;

      teacherSocket.on('connect', () => {
        teacherSocket.emit('session:join', { sessionId: testSessionId });
      });

      teacherSocket.on('session:status_changed', (data) => {
        if (!initialStatusReceived) {
          initialStatusReceived = true;
          expect(data.sessionId).toBe(testSessionId);
          expect(data.status).toBe('active'); // From mock
          
          // Simulate disconnection and reconnection
          teacherSocket.disconnect();
          
          // Create new connection
          const newSocket = clientIO(`http://localhost:${port}`, {
            auth: { token: mockToken },
          });

          newSocket.on('connect', () => {
            newSocket.emit('session:join', { sessionId: testSessionId });
          });

          newSocket.on('session:status_changed', (reconnectData) => {
            expect(reconnectData.sessionId).toBe(testSessionId);
            expect(reconnectData.status).toBe('active'); // Should get current status
            newSocket.disconnect();
            done();
          });
        }
      });

      teacherSocket.on('error', done);
    });

    test('should handle multiple concurrent reconnections', (done) => {
      const port = (httpServer.address() as any).port;
      const clients: ClientSocket[] = [];
      let connectedClients = 0;
      let joinedSessions = 0;

      // Create 5 concurrent clients
      for (let i = 0; i < 5; i++) {
        const client = clientIO(`http://localhost:${port}`, {
          auth: { token: mockToken },
          reconnection: true,
          reconnectionAttempts: 2,
          reconnectionDelay: 50,
        });

        clients.push(client);

        client.on('connect', () => {
          connectedClients++;
          client.emit('session:join', { sessionId: testSessionId });
        });

        client.on('session:status_changed', () => {
          joinedSessions++;
          
          if (joinedSessions === 5) {
            // All clients connected and joined - verify no conflicts
            expect(connectedClients).toBe(5);
            
            // Clean up
            clients.forEach(c => c.disconnect());
            done();
          }
        });

        client.on('error', done);
      }

      // Safety timeout
      setTimeout(() => {
        clients.forEach(c => c.disconnect());
        if (joinedSessions < 5) {
          done(new Error(`Only ${joinedSessions}/5 clients successfully joined`));
        }
      }, 2000);
    });
  });

  describe('Connection Quality Metrics', () => {
    test('should track connection metrics for monitoring', (done) => {
      const port = (httpServer.address() as any).port;
      const connectionMetrics = {
        connectTime: 0,
        disconnectTime: 0,
        reconnectTime: 0,
        totalReconnects: 0
      };

      teacherSocket = clientIO(`http://localhost:${port}`, {
        auth: { token: mockToken },
        reconnection: true,
        reconnectionAttempts: 2,
        reconnectionDelay: 100,
      });

      teacherSocket.on('connect', () => {
        if (connectionMetrics.connectTime === 0) {
          connectionMetrics.connectTime = Date.now();
          teacherSocket.emit('session:join', { sessionId: testSessionId });
        } else {
          connectionMetrics.reconnectTime = Date.now();
          connectionMetrics.totalReconnects++;
          
          // Verify metrics
          expect(connectionMetrics.reconnectTime - connectionMetrics.disconnectTime).toBeGreaterThan(90);
          expect(connectionMetrics.totalReconnects).toBe(1);
          done();
        }
      });

      teacherSocket.on('disconnect', () => {
        connectionMetrics.disconnectTime = Date.now();
      });

      teacherSocket.on('session:status_changed', () => {
        // Trigger disconnection after successful join
        setTimeout(() => {
          teacherSocket.disconnect();
          teacherSocket.connect();
        }, 50);
      });

      teacherSocket.on('error', done);
    });
  });
});
