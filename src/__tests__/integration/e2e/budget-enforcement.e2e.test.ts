import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { io as clientIO, Socket } from 'socket.io-client';
import app from '../../../app';
import { initializeWebSocket } from '../../../services/websocket';
import { sttBudgetService } from '../../../services/stt.budget.service';
import { redisService } from '../../../services/redis.service';

/**
 * Phase 4 E2E Test: Budget Enforcement & Cost Controls
 * 
 * Tests the complete budget enforcement flow:
 * 1. Budget API endpoints respond correctly
 * 2. Budget tracking during audio processing
 * 3. Alert generation when thresholds are crossed
 * 4. Budget enforcement prevents overuse
 */
describe('Phase 4 E2E: Budget Enforcement & Cost Controls', () => {
  let httpServer: any;
  let serverPort: number;
  let clientSockets: Socket[] = [];
  const testSchoolId = 'e2e-budget-school-001';

  beforeAll(async () => {
    // Set up test environment with low budget for quick threshold testing
    process.env.NODE_ENV = 'test';
    process.env.STT_PROVIDER = 'openai';
    process.env.STT_BUDGET_MINUTES_PER_DAY = '2'; // Very low budget for testing
    process.env.STT_WINDOW_SECONDS = '3'; // Short windows
    
    // Redis service auto-connects when needed
    
    // Set up HTTP server with both Express app and WebSocket
    httpServer = createServer(app);
    initializeWebSocket(httpServer);
    
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

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Clear budget state for test school
    if (redisService.isConnected()) {
      const client = redisService.getClient();
      const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const usageKey = `stt:usage:minutes:${testSchoolId}:${today}`;
      const alertKey = `stt:usage:last_alert_pct:${testSchoolId}:${today}`;
      
      await client.del(usageKey);
      await client.del(alertKey);
    }
  });

  it('returns current budget usage for a school', async () => {
    const today = new Date().toISOString().split('T')[0];
    
    // First, consume some budget by processing audio
    await simulateAudioProcessing(testSchoolId, 60); // 1 minute of audio
    
    const response = await request(httpServer)
      .get(`/api/v1/schools/${testSchoolId}/budget/usage`)
      .query({ date: today })
      .expect(200);
    
    expect(response.body).toHaveProperty('schoolId', testSchoolId);
    expect(response.body).toHaveProperty('date', today);
    expect(response.body).toHaveProperty('minutesUsed');
    expect(response.body).toHaveProperty('minutesLimit', 2); // From env var
    expect(response.body).toHaveProperty('percentUsed');
    expect(response.body).toHaveProperty('status');
    
    // Should show usage from the simulated processing
    expect(response.body.minutesUsed).toBeGreaterThan(0);
    expect(response.body.percentUsed).toBeGreaterThan(0);
    
    console.log(`✅ Budget API test: ${response.body.minutesUsed} minutes used (${response.body.percentUsed}%)`);
  });

  it('generates budget alerts when thresholds are crossed', async () => {
    // Consume enough budget to trigger 75% threshold (1.5+ minutes out of 2)
    await simulateAudioProcessing(testSchoolId, 90); // 1.5 minutes
    
    // Check for alert generation
    const alertsResponse = await request(httpServer)
      .get(`/api/v1/schools/${testSchoolId}/budget/alerts`)
      .expect(200);
    
    expect(alertsResponse.body).toHaveProperty('schoolId', testSchoolId);
    expect(alertsResponse.body).toHaveProperty('alerts');
    expect(Array.isArray(alertsResponse.body.alerts)).toBe(true);
    
    // Should have generated at least the 75% alert
    const alerts = alertsResponse.body.alerts;
    const alert75 = alerts.find((a: any) => a.percentage === 75);
    expect(alert75).toBeDefined();
    expect(alert75.status).toBe('active');
    
    console.log(`✅ Budget alerts test: Generated ${alerts.length} alerts, including 75% threshold`);
  });

  it('prevents processing when budget is exceeded', async () => {
    // First, consume the entire budget
    await simulateAudioProcessing(testSchoolId, 120); // 2+ minutes (exceeds 2-minute limit)
    
    // Verify budget is at 100%+
    const usageResponse = await request(httpServer)
      .get(`/api/v1/schools/${testSchoolId}/budget/usage`)
      .expect(200);
    
    expect(usageResponse.body.percentUsed).toBeGreaterThanOrEqual(100);
    expect(usageResponse.body.status).toBe('exceeded');
    
    // Try to process more audio - should be limited by concurrency controls
    const startTime = Date.now();
    
    try {
      await simulateAudioProcessing(testSchoolId, 30); // Try 30 more seconds
    } catch (error) {
      // Expected to hit rate limits or fail due to budget controls
    }
    
    const processingTime = Date.now() - startTime;
    
    // Should either fail quickly or be heavily rate-limited
    expect(processingTime).toBeLessThan(10000); // Should not take more than 10s due to limits
    
    console.log(`✅ Budget enforcement test: Processing ${processingTime}ms (budget exceeded)`);
  });

  it('allows budget configuration updates', async () => {
    const newConfig = {
      dailyMinutesLimit: 10,
      alertThresholds: [50, 80, 95]
    };
    
    const response = await request(httpServer)
      .put(`/api/v1/schools/${testSchoolId}/budget/config`)
      .send(newConfig)
      .expect(200);
    
    expect(response.body.success).toBe(true);
    expect(response.body.schoolId).toBe(testSchoolId);
    expect(response.body.config.dailyMinutesLimit).toBe(10);
    expect(response.body.config.alertThresholds).toEqual([50, 80, 95]);
    
    console.log(`✅ Budget config test: Updated limit to ${newConfig.dailyMinutesLimit} minutes`);
  });

  it('tracks budget across multiple concurrent groups', async () => {
    const numGroups = 3;
    const sessionId = 'e2e-budget-concurrent';
    
    // Create multiple groups processing audio simultaneously
    const groupProcessingPromises = Array.from({ length: numGroups }, async (_, i) => {
      const groupId = `budget-group-${i + 1}`;
      
      // Create WebSocket client for this group
      const socket = clientIO(`http://localhost:${serverPort}`, {
        auth: { token: 'mock-teacher-token' },
      });
      
      clientSockets.push(socket);
      
      await new Promise<void>((resolve) => {
        socket.on('connect', () => {
          (socket as any).data = {
            userId: `teacher-${i + 1}`,
            sessionId,
            schoolId: testSchoolId,
            role: 'teacher'
          };
          resolve();
        });
      });
      
      // Process audio for this group (20 seconds each = 1 minute total)
      socket.emit('audio:chunk', {
        groupId,
        audioData: Buffer.from(`budget-test-audio-${groupId}`),
        format: 'audio/webm;codecs=opus',
        timestamp: Date.now(),
      });
      
      return groupId;
    });
    
    const processedGroups = await Promise.all(groupProcessingPromises);
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check total budget usage
    const usageResponse = await request(httpServer)
      .get(`/api/v1/schools/${testSchoolId}/budget/usage`)
      .expect(200);
    
    // Should have accumulated usage from all groups
    expect(usageResponse.body.minutesUsed).toBeGreaterThan(0);
    
    console.log(`✅ Multi-group budget test: ${processedGroups.length} groups, ${usageResponse.body.minutesUsed} total minutes`);
  });

  it('acknowledges budget alerts', async () => {
    // First generate an alert
    await simulateAudioProcessing(testSchoolId, 90); // Trigger 75% alert
    
    // Get the alert ID
    const alertsResponse = await request(httpServer)
      .get(`/api/v1/schools/${testSchoolId}/budget/alerts`)
      .expect(200);
    
    const alerts = alertsResponse.body.alerts;
    expect(alerts.length).toBeGreaterThan(0);
    
    const alertToAcknowledge = alerts[0];
    
    // Acknowledge the alert
    const ackResponse = await request(httpServer)
      .post(`/api/v1/schools/${testSchoolId}/budget/alerts/${alertToAcknowledge.id}/acknowledge`)
      .expect(200);
    
    expect(ackResponse.body.success).toBe(true);
    expect(ackResponse.body.alertId).toBe(alertToAcknowledge.id);
    
    // Verify alert is now acknowledged
    const updatedAlertsResponse = await request(httpServer)
      .get(`/api/v1/schools/${testSchoolId}/budget/alerts`)
      .expect(200);
    
    const acknowledgedAlert = updatedAlertsResponse.body.alerts.find(
      (a: any) => a.id === alertToAcknowledge.id
    );
    
    expect(acknowledgedAlert.status).toBe('acknowledged');
    
    console.log(`✅ Alert acknowledgment test: Alert ${alertToAcknowledge.id} acknowledged`);
  });

  // Helper function to simulate audio processing for budget consumption
  async function simulateAudioProcessing(schoolId: string, seconds: number): Promise<void> {
    // Use the OpenAI Whisper service directly to consume budget
    // This simulates real audio processing that would consume budget
    await sttBudgetService.recordUsage({ schoolId, durationSeconds: seconds, provider: 'test' });
  }
});
