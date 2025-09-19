import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { io as clientIO, Socket } from 'socket.io-client';
import { performance } from 'perf_hooks';
import { initializeWebSocket } from '../../../services/websocket';
import { inMemoryAudioProcessor } from '../../../services/audio/InMemoryAudioProcessor';
import { openAIWhisperService } from '../../../services/openai-whisper.service';
import { redisService } from '../../../services/redis.service';

/**
 * Phase 4 E2E Test: Cost Validation Under Classroom Load
 * 
 * Simulates realistic classroom scenarios:
 * 1. 25+ groups (typical school class sizes)
 * 2. Concurrent audio streaming
 * 3. Window adaptation under load
 * 4. Memory cleanup validation
 * 5. Cost efficiency metrics
 */
describe('Phase 4 E2E: Cost Validation Under Classroom Load', () => {
  let httpServer: any;
  let serverPort: number;
  let websocketService: any;
  let clientSockets: Socket[] = [];

  beforeAll(async () => {
    // Set up realistic classroom environment
    process.env.NODE_ENV = 'test';
    process.env.STT_PROVIDER = 'openai';
    process.env.STT_WINDOW_SECONDS = '15'; // Production-like window size
    process.env.OPENAI_WHISPER_CONCURRENCY = '20'; // Reasonable concurrency
    process.env.STT_BUDGET_MINUTES_PER_DAY = '480'; // 8 hours for full school day
    
    // Redis service auto-connects when needed
    
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
    await Promise.all(clientSockets.map(socket => {
      if (socket.connected) socket.disconnect();
    }));
    
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
    
    // Redis service cleanup handled automatically
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear audio processor state
    (inMemoryAudioProcessor as any).groupWindows?.clear?.();
  });

  it('handles 25 concurrent groups (typical classroom size)', async () => {
    const numGroups = 25;
    const sessionId = 'e2e-classroom-load';
    const schoolId = 'e2e-classroom-001';
    
    console.log(`🏫 Starting classroom load test: ${numGroups} groups`);
    
    // Performance tracking
    const startTime = performance.now();
    const memoryBefore = process.memoryUsage();
    let transcriptionCount = 0;
    let errorCount = 0;
    
    // Create connections for all groups
    const groupClients = await Promise.all(
      Array.from({ length: numGroups }, async (_, i) => {
        const groupId = `classroom-group-${String(i + 1).padStart(2, '0')}`;
        const socket = clientIO(`http://localhost:${serverPort}`, {
          auth: { token: 'mock-teacher-token' },
          timeout: 30000,
        });
        
        clientSockets.push(socket);
        
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error(`Connection timeout for ${groupId}`)), 10000);
          
          socket.on('connect', () => {
            clearTimeout(timeout);
            (socket as any).data = {
              userId: `student-leader-${i + 1}`,
              sessionId,
              schoolId,
              role: 'student' // Group leaders are students
            };
            resolve();
          });
          
          socket.on('connect_error', (error: any) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
        
        // Track transcription events
        socket.on('transcription:group:new', () => {
          transcriptionCount++;
        });
        
        socket.on('error', () => {
          errorCount++;
        });
        
        return { socket, groupId };
      })
    );
    
    console.log(`✅ Connected ${groupClients.length} groups in ${Math.round(performance.now() - startTime)}ms`);
    
    // Simulate realistic classroom audio streaming
    const audioStreamingPromises = groupClients.map(async ({ socket, groupId }, index) => {
      try {
        // Stagger the start times to simulate realistic classroom dynamics
        await new Promise(resolve => setTimeout(resolve, index * 100));
        
        socket.emit('audio:stream:start', { groupId });
        
        // Send realistic audio chunks (simulating 2 minutes of discussion)
        const discussionDurationMs = 2 * 60 * 1000; // 2 minutes
        const chunkIntervalMs = 500; // Send chunks every 500ms
        const numChunks = discussionDurationMs / chunkIntervalMs;
        
        for (let chunk = 0; chunk < numChunks; chunk++) {
          if (socket.connected) {
            const audioData = Buffer.from(`classroom-audio-${groupId}-chunk-${chunk}-${Date.now()}`);
            
            socket.emit('audio:chunk', {
              groupId,
              audioData,
              format: 'audio/webm;codecs=opus',
              timestamp: Date.now(),
            });
            
            await new Promise(resolve => setTimeout(resolve, chunkIntervalMs));
          }
        }
        
        socket.emit('audio:stream:end', { groupId });
      } catch (error) {
        console.error(`Error in group ${groupId}:`, error);
        errorCount++;
      }
    });
    
    // Execute all streaming in parallel and measure performance
    const streamingStartTime = performance.now();
    await Promise.all(audioStreamingPromises);
    const streamingDuration = performance.now() - streamingStartTime;
    
    // Wait for all processing to complete
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const totalDuration = performance.now() - startTime;
    const memoryAfter = process.memoryUsage();
    
    // Performance Validation
    expect(errorCount).toBeLessThan(numGroups * 0.1); // < 10% error rate
    expect(transcriptionCount).toBeGreaterThan(0); // At least some transcriptions
    expect(totalDuration).toBeLessThan(180000); // Complete within 3 minutes
    
    // Memory Validation
    const memoryGrowthMB = (memoryAfter.heapUsed - memoryBefore.heapUsed) / 1024 / 1024;
    expect(memoryGrowthMB).toBeLessThan(500); // Less than 500MB growth
    
    // Cost Efficiency Metrics
    const avgProcessingTimePerGroup = streamingDuration / numGroups;
    expect(avgProcessingTimePerGroup).toBeLessThan(5000); // < 5s per group average
    
    console.log(`🎯 Classroom Load Test Results:`);
    console.log(`   Groups: ${numGroups}`);
    console.log(`   Total Duration: ${Math.round(totalDuration)}ms`);
    console.log(`   Transcriptions: ${transcriptionCount}`);
    console.log(`   Errors: ${errorCount} (${Math.round(errorCount/numGroups*100)}%)`);
    console.log(`   Memory Growth: ${Math.round(memoryGrowthMB)}MB`);
    console.log(`   Avg Time/Group: ${Math.round(avgProcessingTimePerGroup)}ms`);
  }, 300000); // 5 minute timeout for this intensive test

  it('validates window adaptation under 429 rate limiting', async () => {
    const numGroups = 15;
    const sessionId = 'e2e-rate-limit-test';
    
    // Mock OpenAI service to simulate 429 responses
    const originalTranscribe = openAIWhisperService.transcribeBuffer;
    let callCount = 0;
    let retryCount = 0;
    
    jest.spyOn(openAIWhisperService, 'transcribeBuffer').mockImplementation(async (...args) => {
      callCount++;
      
      // Simulate 429 errors for 30% of calls to test adaptation
      if (callCount % 3 === 0) {
        retryCount++;
        const error: any = new Error('Rate limit exceeded');
        error.status = 429;
        throw error;
      }
      
      return originalTranscribe.apply(openAIWhisperService, args);
    });
    
    // Create groups and trigger concurrent window flushes
    const groupClients = await Promise.all(
      Array.from({ length: numGroups }, async (_, i) => {
        const groupId = `rate-limit-group-${i + 1}`;
        const socket = clientIO(`http://localhost:${serverPort}`, {
          auth: { token: 'mock-teacher-token' },
        });
        
        clientSockets.push(socket);
        
        await new Promise<void>((resolve) => {
          socket.on('connect', () => {
            (socket as any).data = {
              userId: `user-${i + 1}`,
              sessionId,
              schoolId: 'e2e-rate-limit-school',
              role: 'teacher'
            };
            resolve();
          });
        });
        
        return { socket, groupId };
      })
    );
    
    // Trigger rapid audio processing to hit rate limits
    const rapidProcessingPromises = groupClients.map(async ({ socket, groupId }) => {
      socket.emit('audio:chunk', {
        groupId,
        audioData: Buffer.from(`rate-limit-test-${groupId}`),
        format: 'audio/webm;codecs=opus',
        timestamp: Date.now(),
      });
      
      // Force window boundary to trigger immediate processing
      const groupWindow = (inMemoryAudioProcessor as any).groupWindows?.get(groupId);
      if (groupWindow) {
        groupWindow.windowStartedAt = Date.now() - (16 * 1000); // Force boundary
        
        // Trigger another chunk to flush
        socket.emit('audio:chunk', {
          groupId,
          audioData: Buffer.from(`flush-${groupId}`),
          format: 'audio/webm;codecs=opus',
          timestamp: Date.now(),
        });
      }
    });
    
    await Promise.all(rapidProcessingPromises);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Validate adaptation behavior
    expect(callCount).toBeGreaterThan(numGroups); // At least one call per group
    expect(retryCount).toBeGreaterThan(0); // Some 429 errors occurred
    
    // Check window adaptation - windows should have increased due to 429s
    const groupWindows = (inMemoryAudioProcessor as any).groupWindows;
    let adaptedWindows = 0;
    
    for (const [groupId, window] of groupWindows.entries()) {
      if (window.windowSeconds > 15) { // Greater than initial 15s
        adaptedWindows++;
      }
    }
    
    expect(adaptedWindows).toBeGreaterThan(0); // At least some windows adapted
    
    console.log(`🔄 Rate Limiting Test Results:`);
    console.log(`   API Calls: ${callCount}`);
    console.log(`   429 Errors: ${retryCount} (${Math.round(retryCount/callCount*100)}%)`);
    console.log(`   Adapted Windows: ${adaptedWindows}/${groupWindows.size}`);
    
    // Restore original implementation
    jest.restoreAllMocks();
  }, 60000);

  it('validates memory cleanup after processing sessions', async () => {
    const numSessions = 3;
    const groupsPerSession = 8;
    
    console.log(`🧹 Memory cleanup test: ${numSessions} sessions × ${groupsPerSession} groups`);
    
    const initialMemory = process.memoryUsage();
    let peakMemory = initialMemory;
    
    // Run multiple sessions sequentially to test cleanup
    for (let sessionIndex = 0; sessionIndex < numSessions; sessionIndex++) {
      const sessionId = `memory-test-session-${sessionIndex}`;
      
      // Create groups for this session
      const sessionClients = await Promise.all(
        Array.from({ length: groupsPerSession }, async (_, groupIndex) => {
          const groupId = `memory-s${sessionIndex}-g${groupIndex}`;
          const socket = clientIO(`http://localhost:${serverPort}`, {
            auth: { token: 'mock-teacher-token' },
          });
          
          clientSockets.push(socket);
          
          await new Promise<void>((resolve) => {
            socket.on('connect', () => {
              (socket as any).data = {
                userId: `user-s${sessionIndex}-${groupIndex}`,
                sessionId,
                schoolId: 'memory-test-school',
                role: 'teacher'
              };
              resolve();
            });
          });
          
          return { socket, groupId };
        })
      );
      
      // Process audio for all groups in this session
      await Promise.all(
        sessionClients.map(async ({ socket, groupId }) => {
          socket.emit('audio:chunk', {
            groupId,
            audioData: Buffer.from(`memory-test-${groupId}-${Date.now()}`),
            format: 'audio/webm;codecs=opus',
            timestamp: Date.now(),
          });
        })
      );
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check memory usage
      const currentMemory = process.memoryUsage();
      if (currentMemory.heapUsed > peakMemory.heapUsed) {
        peakMemory = currentMemory;
      }
      
      // Disconnect all clients for this session (simulating session end)
      await Promise.all(
        sessionClients.map(({ socket }) => {
          if (socket.connected) {
            socket.disconnect();
          }
        })
      );
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      // Remove from clientSockets array
      clientSockets = clientSockets.filter(s => !sessionClients.some(sc => sc.socket === s));
    }
    
    // Final memory check after all sessions
    await new Promise(resolve => setTimeout(resolve, 2000));
    const finalMemory = process.memoryUsage();
    
    const memoryGrowthMB = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
    const peakGrowthMB = (peakMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
    
    // Memory should not grow excessively after cleanup
    expect(memoryGrowthMB).toBeLessThan(100); // Less than 100MB permanent growth
    expect(peakGrowthMB).toBeLessThan(300); // Peak should be reasonable
    
    console.log(`🧹 Memory Cleanup Results:`);
    console.log(`   Initial Memory: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB`);
    console.log(`   Peak Memory: ${Math.round(peakMemory.heapUsed / 1024 / 1024)}MB (+${Math.round(peakGrowthMB)}MB)`);
    console.log(`   Final Memory: ${Math.round(finalMemory.heapUsed / 1024 / 1024)}MB (+${Math.round(memoryGrowthMB)}MB)`);
  }, 120000); // 2 minute timeout

  it('measures cost efficiency per transcription', async () => {
    const numGroups = 10;
    const sessionId = 'cost-efficiency-test';
    
    const startTime = performance.now();
    let transcriptionCount = 0;
    let totalAudioSeconds = 0;
    
    // Create groups and track transcription metrics
    const groupClients = await Promise.all(
      Array.from({ length: numGroups }, async (_, i) => {
        const groupId = `cost-group-${i + 1}`;
        const socket = clientIO(`http://localhost:${serverPort}`, {
          auth: { token: 'mock-teacher-token' },
        });
        
        clientSockets.push(socket);
        
        await new Promise<void>((resolve) => {
          socket.on('connect', () => {
            (socket as any).data = {
              userId: `cost-user-${i + 1}`,
              sessionId,
              schoolId: 'cost-efficiency-school',
              role: 'teacher'
            };
            resolve();
          });
        });
        
        socket.on('transcription:group:new', (data: any) => {
          if (data.groupId === groupId) {
            transcriptionCount++;
          }
        });
        
        return { socket, groupId };
      })
    );
    
    // Process known amounts of audio for cost calculation
    const audioPerGroupSeconds = 30; // 30 seconds per group
    totalAudioSeconds = numGroups * audioPerGroupSeconds;
    
    await Promise.all(
      groupClients.map(async ({ socket, groupId }) => {
        // Send multiple chunks to simulate the target duration
        const chunksPerGroup = 6; // 6 chunks × 5s = 30s
        
        for (let chunk = 0; chunk < chunksPerGroup; chunk++) {
          socket.emit('audio:chunk', {
            groupId,
            audioData: Buffer.from(`cost-audio-${groupId}-${chunk}`),
            format: 'audio/webm;codecs=opus',
            timestamp: Date.now(),
          });
          
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      })
    );
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const totalTime = performance.now() - startTime;
    
    // Calculate efficiency metrics
    const avgTimePerTranscription = transcriptionCount > 0 ? totalTime / transcriptionCount : Infinity;
    const avgTimePerAudioSecond = totalTime / totalAudioSeconds;
    const transcriptionRate = transcriptionCount / numGroups; // Should be close to 1
    
    // Efficiency expectations
    expect(transcriptionCount).toBeGreaterThan(numGroups * 0.8); // At least 80% success rate
    expect(avgTimePerTranscription).toBeLessThan(10000); // < 10s per transcription
    expect(avgTimePerAudioSecond).toBeLessThan(500); // < 500ms per second of audio
    
    console.log(`💰 Cost Efficiency Results:`);
    console.log(`   Groups: ${numGroups}`);
    console.log(`   Audio Processed: ${totalAudioSeconds}s`);
    console.log(`   Transcriptions: ${transcriptionCount}`);
    console.log(`   Success Rate: ${Math.round(transcriptionRate * 100)}%`);
    console.log(`   Time/Transcription: ${Math.round(avgTimePerTranscription)}ms`);
    console.log(`   Time/Audio Second: ${Math.round(avgTimePerAudioSecond)}ms`);
  }, 60000);
});
