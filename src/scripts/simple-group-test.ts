import { config } from 'dotenv';
import { join } from 'path';
import { logger } from '../utils/logger';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function simpleGroupTest() {
  try {
    logger.debug('🔍 Simple Group Creation Test...');
    
    // Test with a simple payload - this should trigger the server error
    const payload = {
      name: 'Test Group',
      maxMembers: 4
    };
    
    logger.debug('Making request to create group...');
    logger.debug('URL: http://localhost:3000/api/v1/sessions/test-session-id/groups');
    logger.debug('Payload:', JSON.stringify(payload, null, 2));
    
    const response = await fetch('http://localhost:3000/api/v1/sessions/test-session-id/groups', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid-token' // This will trigger auth error first
      },
      body: JSON.stringify(payload)
    });
    
    const responseText = await response.text();
    logger.debug('Response status:', response.status);
    logger.debug('Response:', responseText);
    
    // Now test with a real session (we should see what error occurs)
    logger.debug('\n--- Testing with minimal session creation ---');
    
    const healthCheck = await fetch('http://localhost:3000/api/v1/health');
    const healthData = await healthCheck.text();
    logger.debug('Health check:', healthData);
    
  } catch (error) {
    logger.error('❌ Error:', error);
  }
}

if (require.main === module) {
  simpleGroupTest();
}

export { simpleGroupTest };