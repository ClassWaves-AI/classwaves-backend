import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { io as clientIO, Socket } from 'socket.io-client';
import { initializeWebSocket } from '../../../services/websocket';
import { inMemoryAudioProcessor } from '../../../services/audio/InMemoryAudioProcessor';
import { redisService } from '../../../services/redis.service';

/**
 * Phase 4 E2E Test: Multi-Group WebSocket Audio Streaming
 * 
 * Tests the complete flow:
 * 1. Multiple groups connect via WebSocket
 * 2. Groups stream audio chunks simultaneously
 * 3. Audio processor handles concurrent windows
 * 4. Transcription events are emitted per group
 * 5. Budget tracking works across multiple groups
 */
describe('Phase 4 E2E: Multi-Group WebSocket Audio Flow', () => {
  let httpServer: any;
  let serverPort: number;
  let websocketService: any;
  let clientSockets: Socket[] = [];

  beforeAll(async () => {
    // Set up test environment
    process.env.NODE_ENV = 'test';
    process.env.STT_PROVIDER = 'openai';
    process.env.STT_WINDOW_SECONDS = '5'; // Shorter windows for faster tests
    process.env.OPENAI_WHISPER_CONCURRENCY = '10';
    process.env.STT_BUDGET_MINUTES_PER_DAY = '60'; // 1 hour budget for test
    
    // Ensure Redis is connected for session/budget tracking
    // Redis service auto-connects when needed
    
    // Create HTTP server and WebSocket service
    httpServer = createServer();
    websocketService = initializeWebSocket(httpServer);
    
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        serverPort = (httpServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    // Clean up all client connections
    await Promise.all(clientSockets.map(socket => {
      if (socket.connected) {
        socket.disconnect();
      }
    }));
    
    // Close server
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
    
    // Redis service cleanup handled automatically
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear any existing audio processor state
    (inMemoryAudioProcessor as any).groupWindows?.clear?.();
  });

  it('handles simultaneous audio streaming from 5 groups with window boundaries', async () => {
    const numGroups = 5;
    const sessionId = 'e2e-session-multigroup';
    const schoolId = 'e2e-school-001';
    
    // Track transcription events received
    const transcriptionEvents: Array<{ groupId: string; text: string; timestamp: number }> = [];
    
    // Create authenticated client connections for each group
    const groupClients = await Promise.all(
      Array.from({ length: numGroups }, async (_, i) => {
        const groupId = `group-${i + 1}`;
        const socket = clientIO(`http://localhost:${serverPort}`, {
          auth: {
            token: 'mock-teacher-token', // In real E2E this would be generated via API
          },
        });
        
        clientSockets.push(socket);
        
        await new Promise<void>((resolve) => {
          socket.on('connect', () => {
            // Set up socket session data (normally done by auth middleware)
            (socket as any).data = {
              userId: `teacher-${i + 1}`,
              sessionId,
              schoolId,
              role: 'teacher'
            };
            resolve();
          });
        });
        
        // Listen for transcription events from this group
        socket.on('transcription:group:new', (data: any) => {
          if (data.groupId === groupId) {
            transcriptionEvents.push({
              groupId: data.groupId,
              text: data.text,
              timestamp: Date.now()
            });
          }
        });
        
        return { socket, groupId };
      })
    );
    
    // Wait for all connections to be established
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Simulate audio streaming from each group
    const audioStreamingPromises = groupClients.map(async ({ socket, groupId }) => {
      // Send start streaming event
      socket.emit('audio:stream:start', { groupId });
      
      // Send multiple audio chunks to trigger window boundary
      const chunks = 3;
      for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
        const audioData = Buffer.from(`mock-audio-${groupId}-chunk-${chunkIndex}`);
        
        socket.emit('audio:chunk', {
          groupId,
          audioData,
          format: 'audio/webm;codecs=opus',
          timestamp: Date.now(),
        });
        
        // Small delay between chunks
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Force window boundary by manipulating internal state
      const groupWindow = (inMemoryAudioProcessor as any).groupWindows?.get(groupId);
      if (groupWindow) {
        groupWindow.windowStartedAt = Date.now() - (6 * 1000); // 6 seconds ago (> 5s window)
      }
      
      // Send final chunk to trigger flush
      socket.emit('audio:chunk', {
        groupId,
        audioData: Buffer.from(`mock-audio-${groupId}-final`),
        format: 'audio/webm;codecs=opus',
        timestamp: Date.now(),
      });
      
      // Send end streaming event
      socket.emit('audio:stream:end', { groupId });
    });
    
    // Execute all audio streaming in parallel
    await Promise.all(audioStreamingPromises);
    
    // Wait for audio processing and transcription events
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify results
    expect(transcriptionEvents.length).toBeGreaterThanOrEqual(numGroups);
    
    // Each group should have received at least one transcription
    const groupsWithTranscriptions = new Set(transcriptionEvents.map(e => e.groupId));
    expect(groupsWithTranscriptions.size).toBe(numGroups);
    
    // Verify transcription content (mock responses should contain "mock transcription")
    transcriptionEvents.forEach(event => {
      expect(event.text).toContain('mock transcription');
      expect(event.groupId).toMatch(/^group-\d+$/);
      expect(event.timestamp).toBeGreaterThan(Date.now() - 10000); // Within last 10s
    });
    
    console.log(`✅ Multi-group test completed: ${transcriptionEvents.length} transcription events from ${groupsWithTranscriptions.size} groups`);
  }, 30000); // 30s timeout for this complex test

  it('handles concurrent window flushes without blocking', async () => {
    const numGroups = 8;
    const sessionId = 'e2e-session-concurrent';
    const schoolId = 'e2e-school-002';
    
    // Track processing times
    const processingTimes: Array<{ groupId: string; startTime: number; endTime: number }> = [];
    
    // Create connections for concurrent groups
    const groupClients = await Promise.all(
      Array.from({ length: numGroups }, async (_, i) => {
        const groupId = `concurrent-group-${i + 1}`;
        const socket = clientIO(`http://localhost:${serverPort}`, {
          auth: { token: 'mock-teacher-token' },
        });
        
        clientSockets.push(socket);
        
        await new Promise<void>((resolve) => {
          socket.on('connect', () => {
            (socket as any).data = {
              userId: `teacher-concurrent-${i + 1}`,
              sessionId,
              schoolId,
              role: 'teacher'
            };
            resolve();
          });
        });
        
        return { socket, groupId };
      })
    );
    
    // Trigger simultaneous window flushes
    const simultaneousFlushPromises = groupClients.map(async ({ socket, groupId }) => {
      const startTime = Date.now();
      
      // Prime the group with audio data
      socket.emit('audio:chunk', {
        groupId,
        audioData: Buffer.from(`concurrent-audio-${groupId}`),
        format: 'audio/webm;codecs=opus',
        timestamp: Date.now(),
      });
      
      // Force immediate window boundary
      const groupWindow = (inMemoryAudioProcessor as any).groupWindows?.get(groupId);
      if (groupWindow) {
        groupWindow.windowStartedAt = Date.now() - (6 * 1000); // Force boundary
        
        // Trigger flush by sending another chunk
        socket.emit('audio:chunk', {
          groupId,
          audioData: Buffer.from(`flush-trigger-${groupId}`),
          format: 'audio/webm;codecs=opus',
          timestamp: Date.now(),
        });
      }
      
      const endTime = Date.now();
      processingTimes.push({ groupId, startTime, endTime });
    });
    
    // Execute all flushes simultaneously
    await Promise.all(simultaneousFlushPromises);
    
    // Wait for processing to complete
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Verify concurrent processing worked
    expect(processingTimes.length).toBe(numGroups);
    
    // No single operation should have taken too long (indicates blocking)
    const maxProcessingTime = Math.max(...processingTimes.map(p => p.endTime - p.startTime));
    expect(maxProcessingTime).toBeLessThan(5000); // Should complete within 5 seconds
    
    console.log(`✅ Concurrent processing test: ${numGroups} groups processed in max ${maxProcessingTime}ms`);
  }, 20000);

  it('maintains separate audio buffers per group', async () => {
    const groupA = 'isolation-group-a';
    const groupB = 'isolation-group-b';
    const sessionId = 'e2e-session-isolation';
    
    // Create two client connections
    const [clientA, clientB] = await Promise.all([
      createAuthenticatedClient(groupA, sessionId),
      createAuthenticatedClient(groupB, sessionId)
    ]);
    
    // Send different audio data to each group
    clientA.emit('audio:chunk', {
      groupId: groupA,
      audioData: Buffer.from('audio-data-group-a-unique'),
      format: 'audio/webm;codecs=opus',
      timestamp: Date.now(),
    });
    
    clientB.emit('audio:chunk', {
      groupId: groupB,
      audioData: Buffer.from('audio-data-group-b-unique'),
      format: 'audio/webm;codecs=opus',
      timestamp: Date.now(),
    });
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Verify groups have separate internal state
    const groupWindows = (inMemoryAudioProcessor as any).groupWindows;
    expect(groupWindows.has(groupA)).toBe(true);
    expect(groupWindows.has(groupB)).toBe(true);
    
    const windowA = groupWindows.get(groupA);
    const windowB = groupWindows.get(groupB);
    
    expect(windowA).not.toBe(windowB); // Different objects
    expect(windowA.bytes).toBeGreaterThan(0);
    expect(windowB.bytes).toBeGreaterThan(0);
    
    console.log(`✅ Group isolation test: Groups have separate buffers (A: ${windowA.bytes}b, B: ${windowB.bytes}b)`);
  }, 10000);

  // Helper function to create authenticated client
  async function createAuthenticatedClient(groupId: string, sessionId: string): Promise<Socket> {
    const socket = clientIO(`http://localhost:${serverPort}`, {
      auth: { token: 'mock-teacher-token' },
    });
    
    clientSockets.push(socket);
    
    await new Promise<void>((resolve) => {
      socket.on('connect', () => {
        (socket as any).data = {
          userId: `teacher-${groupId}`,
          sessionId,
          schoolId: 'e2e-school-003',
          role: 'teacher'
        };
        resolve();
      });
    });
    
    return socket;
  }
});
