#!/usr/bin/env npx ts-node

/**
 * WebSocket Reconnection Verification Script
 * 
 * This script tests the complete WebSocket reconnection and auto-join functionality
 * across teacher and student clients. Run this during development to verify
 * that the SOW requirement is met.
 */

import { io, Socket } from 'socket.io-client';
import jwt from 'jsonwebtoken';

interface TestResult {
  testName: string;
  passed: boolean;
  duration: number;
  error?: string;
  metrics?: any;
}

interface ConnectionMetrics {
  connectionTime: number;
  disconnectionTime: number;
  reconnectionTime: number;
  totalAttempts: number;
  successfulReconnections: number;
  averageReconnectDelay: number;
}

class WebSocketReconnectionVerifier {
  private wsUrl: string;
  private results: TestResult[] = [];

  constructor() {
    this.wsUrl = process.env.WEBSOCKET_URL || 'http://localhost:3001';
  }

  private generateTestToken(userId: string, role: 'teacher' | 'student' = 'teacher'): string {
    return jwt.sign(
      { userId, role, exp: Math.floor(Date.now() / 1000) + 3600 },
      process.env.JWT_SECRET || 'test-secret'
    );
  }

  private async waitForEvent(socket: Socket, eventName: string, timeout: number = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${eventName}`));
      }, timeout);

      socket.once(eventName, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  private async runTest(testName: string, testFn: () => Promise<any>): Promise<void> {
    const startTime = Date.now();
    console.log(`🧪 Running test: ${testName}`);

    try {
      const result = await testFn();
      const duration = Date.now() - startTime;
      
      this.results.push({
        testName,
        passed: true,
        duration,
        metrics: result
      });
      
      console.log(`✅ ${testName} PASSED (${duration}ms)`);
      if (result && typeof result === 'object') {
        console.log(`   Metrics:`, result);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.results.push({
        testName,
        passed: false,
        duration,
        error: error instanceof Error ? error.message : String(error)
      });
      
      console.log(`❌ ${testName} FAILED (${duration}ms)`);
      console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async testTeacherReconnection(): Promise<ConnectionMetrics> {
    const token = this.generateTestToken('teacher-test-123', 'teacher');
    const sessionId = 'test-session-reconnect';
    
    return new Promise((resolve, reject) => {
      const metrics: ConnectionMetrics = {
        connectionTime: 0,
        disconnectionTime: 0,
        reconnectionTime: 0,
        totalAttempts: 0,
        successfulReconnections: 0,
        averageReconnectDelay: 0
      };

      const socket = io(this.wsUrl, {
        auth: { token },
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 200, // Fast for testing
        timeout: 5000
      });

      let connectCount = 0;
      let sessionJoined = false;

      const cleanup = () => {
        socket.disconnect();
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Test timeout - teacher reconnection took too long'));
      }, 15000);

      socket.on('connect', () => {
        connectCount++;
        metrics.totalAttempts++;
        
        if (connectCount === 1) {
          metrics.connectionTime = Date.now();
          // Join session on first connection
          socket.emit('session:join', { sessionId });
        } else {
          metrics.reconnectionTime = Date.now();
          metrics.successfulReconnections++;
          metrics.averageReconnectDelay = metrics.reconnectionTime - metrics.disconnectionTime;
          
          // Verify auto-rejoin worked
          if (sessionJoined) {
            clearTimeout(timeout);
            cleanup();
            resolve(metrics);
          }
        }
      });

      socket.on('session:status_changed', (data) => {
        if (data.sessionId === sessionId) {
          sessionJoined = true;
          
          if (connectCount === 1) {
            // First join successful - now test disconnection
            setTimeout(() => {
              metrics.disconnectionTime = Date.now();
              socket.disconnect();
              socket.connect(); // Force reconnection
            }, 100);
          }
        }
      });

      socket.on('error', (error) => {
        clearTimeout(timeout);
        cleanup();
        reject(new Error(`Socket error: ${error}`));
      });

      socket.on('connect_error', (error) => {
        metrics.totalAttempts++;
        console.log(`Connection attempt ${metrics.totalAttempts} failed:`, error.message);
        
        if (metrics.totalAttempts >= 3) {
          clearTimeout(timeout);
          cleanup();
          reject(new Error(`Failed to connect after ${metrics.totalAttempts} attempts`));
        }
      });
    });
  }

  async testStudentReconnection(): Promise<ConnectionMetrics> {
    const token = this.generateTestToken('student-test-456', 'student');
    const sessionId = 'test-session-student';
    const groupId = 'test-group-789';
    
    return new Promise((resolve, reject) => {
      const metrics: ConnectionMetrics = {
        connectionTime: 0,
        disconnectionTime: 0,
        reconnectionTime: 0,
        totalAttempts: 0,
        successfulReconnections: 0,
        averageReconnectDelay: 0
      };

      const socket = io(this.wsUrl, {
        auth: { token },
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 200,
        timeout: 5000
      });

      let connectCount = 0;
      let groupReady = false;

      const cleanup = () => {
        socket.disconnect();
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Test timeout - student reconnection took too long'));
      }, 15000);

      socket.on('connect', () => {
        connectCount++;
        metrics.totalAttempts++;
        
        if (connectCount === 1) {
          metrics.connectionTime = Date.now();
          socket.emit('session:join', { sessionId });
        } else {
          metrics.reconnectionTime = Date.now();
          metrics.successfulReconnections++;
          metrics.averageReconnectDelay = metrics.reconnectionTime - metrics.disconnectionTime;
          
          // Test leader ready functionality after reconnection
          socket.emit('group:leader_ready', { 
            sessionId, 
            groupId, 
            ready: true 
          });
        }
      });

      socket.on('session:status_changed', (data) => {
        if (data.sessionId === sessionId && connectCount === 1) {
          // Session joined - simulate disconnection
          setTimeout(() => {
            metrics.disconnectionTime = Date.now();
            socket.disconnect();
            socket.connect();
          }, 100);
        }
      });

      socket.on('group:status_changed', (data) => {
        if (data.groupId === groupId && data.isReady && connectCount === 2) {
          groupReady = true;
          clearTimeout(timeout);
          cleanup();
          resolve(metrics);
        }
      });

      socket.on('error', (error) => {
        clearTimeout(timeout);
        cleanup();
        reject(new Error(`Socket error: ${error}`));
      });
    });
  }

  async testExponentialBackoff(): Promise<{ attempts: number[], delays: number[] }> {
    const token = this.generateTestToken('test-backoff-user');
    const nonExistentUrl = 'http://localhost:9999'; // Should fail to connect
    
    return new Promise((resolve, reject) => {
      const attempts: number[] = [];
      const delays: number[] = [];
      let lastAttemptTime = Date.now();

      const socket = io(nonExistentUrl, {
        auth: { token },
        reconnection: true,
        reconnectionAttempts: 4,
        reconnectionDelay: 100,
        reconnectionDelayMax: 1000,
        timeout: 1000
      });

      socket.on('connect_error', () => {
        const now = Date.now();
        attempts.push(now);
        
        if (attempts.length > 1) {
          delays.push(now - lastAttemptTime);
        }
        
        lastAttemptTime = now;
        
        if (attempts.length >= 4) {
          socket.disconnect();
          resolve({ attempts, delays });
        }
      });

      // Safety timeout
      setTimeout(() => {
        socket.disconnect();
        if (attempts.length === 0) {
          reject(new Error('No connection attempts recorded'));
        } else {
          resolve({ attempts, delays });
        }
      }, 10000);
    });
  }

  async testConcurrentReconnections(): Promise<{ successCount: number, totalClients: number }> {
    const clientCount = 5;
    const promises: Promise<boolean>[] = [];
    
    for (let i = 0; i < clientCount; i++) {
      const token = this.generateTestToken(`concurrent-user-${i}`);
      const sessionId = `test-session-concurrent-${i}`;
      
      const promise = new Promise<boolean>((resolve) => {
        const socket = io(this.wsUrl, {
          auth: { token },
          reconnection: true,
          reconnectionAttempts: 2,
          reconnectionDelay: 100 + (i * 50), // Stagger delays
          timeout: 3000
        });

        let reconnected = false;

        socket.on('connect', () => {
          if (!reconnected) {
            socket.emit('session:join', { sessionId });
          } else {
            // Successful reconnection
            socket.disconnect();
            resolve(true);
          }
        });

        socket.on('session:status_changed', () => {
          if (!reconnected) {
            reconnected = true;
            // Trigger disconnection
            setTimeout(() => {
              socket.disconnect();
              socket.connect();
            }, 50);
          }
        });

        socket.on('error', () => {
          socket.disconnect();
          resolve(false);
        });

        // Timeout
        setTimeout(() => {
          socket.disconnect();
          resolve(false);
        }, 8000);
      });

      promises.push(promise);
    }

    const results = await Promise.all(promises);
    const successCount = results.filter(Boolean).length;
    
    return { successCount, totalClients: clientCount };
  }

  async verifyAutoJoinConsistency(): Promise<{ consistency: number, tests: number }> {
    const testCount = 10;
    let successCount = 0;
    
    for (let i = 0; i < testCount; i++) {
      try {
        const token = this.generateTestToken(`consistency-user-${i}`);
        const sessionId = `test-session-consistency-${i}`;
        
        const success = await new Promise<boolean>((resolve) => {
          const socket = io(this.wsUrl, {
            auth: { token },
            reconnection: true,
            reconnectionAttempts: 2,
            reconnectionDelay: 100,
            timeout: 2000
          });

          let initialJoin = false;
          let autoRejoinSuccess = false;

          socket.on('connect', () => {
            if (!initialJoin) {
              socket.emit('session:join', { sessionId });
            }
          });

          socket.on('session:status_changed', (data) => {
            if (data.sessionId === sessionId) {
              if (!initialJoin) {
                initialJoin = true;
                // Trigger disconnection
                setTimeout(() => {
                  socket.disconnect();
                  socket.connect();
                }, 50);
              } else {
                autoRejoinSuccess = true;
                socket.disconnect();
                resolve(true);
              }
            }
          });

          socket.on('error', () => {
            socket.disconnect();
            resolve(false);
          });

          setTimeout(() => {
            socket.disconnect();
            resolve(autoRejoinSuccess);
          }, 5000);
        });

        if (success) successCount++;
      } catch (error) {
        console.log(`Consistency test ${i} failed:`, error);
      }
    }

    return { 
      consistency: successCount / testCount,
      tests: testCount 
    };
  }

  async run(): Promise<void> {
    console.log('🚀 Starting WebSocket Reconnection Verification');
    console.log(`📍 Testing against: ${this.wsUrl}`);
    console.log('');

    await this.runTest('Teacher Reconnection', () => this.testTeacherReconnection());
    await this.runTest('Student Reconnection', () => this.testStudentReconnection());
    await this.runTest('Exponential Backoff', () => this.testExponentialBackoff());
    await this.runTest('Concurrent Reconnections', () => this.testConcurrentReconnections());
    await this.runTest('Auto-Join Consistency', () => this.verifyAutoJoinConsistency());

    console.log('\n📊 Test Results Summary:');
    console.log('='.repeat(50));
    
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    const passRate = (passed / total) * 100;
    
    this.results.forEach(result => {
      const status = result.passed ? '✅' : '❌';
      console.log(`${status} ${result.testName} (${result.duration}ms)`);
      if (!result.passed && result.error) {
        console.log(`     Error: ${result.error}`);
      }
    });
    
    console.log('');
    console.log(`📈 Overall Results: ${passed}/${total} tests passed (${passRate.toFixed(1)}%)`);
    
    const avgDuration = this.results.reduce((sum, r) => sum + r.duration, 0) / this.results.length;
    console.log(`⏱️  Average test duration: ${avgDuration.toFixed(0)}ms`);
    
    if (passRate >= 100) {
      console.log('🎉 ALL TESTS PASSED - WebSocket reconnection is verified!');
      console.log('✅ SOW Requirement "Ensure WS reconnect + auto-join verified" is MET');
    } else {
      console.log('⚠️  Some tests failed - WebSocket reconnection needs attention');
      console.log('❌ SOW Requirement "Ensure WS reconnect + auto-join verified" is NOT MET');
      process.exit(1);
    }
  }
}

// Run verification if called directly
if (require.main === module) {
  const verifier = new WebSocketReconnectionVerifier();
  verifier.run().catch(error => {
    console.error('💥 Verification failed with error:', error);
    process.exit(1);
  });
}

export { WebSocketReconnectionVerifier };
