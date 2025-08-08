import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function simpleGroupTest() {
  try {
    console.log('🔍 Simple Group Creation Test...');
    
    // Test with a simple payload - this should trigger the server error
    const payload = {
      name: 'Test Group',
      maxMembers: 4
    };
    
    console.log('Making request to create group...');
    console.log('URL: http://localhost:3000/api/v1/sessions/test-session-id/groups');
    console.log('Payload:', JSON.stringify(payload, null, 2));
    
    const response = await fetch('http://localhost:3000/api/v1/sessions/test-session-id/groups', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid-token' // This will trigger auth error first
      },
      body: JSON.stringify(payload)
    });
    
    const responseText = await response.text();
    console.log('Response status:', response.status);
    console.log('Response:', responseText);
    
    // Now test with a real session (we should see what error occurs)
    console.log('\n--- Testing with minimal session creation ---');
    
    const healthCheck = await fetch('http://localhost:3000/api/v1/health');
    const healthData = await healthCheck.text();
    console.log('Health check:', healthData);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

if (require.main === module) {
  simpleGroupTest();
}

export { simpleGroupTest };
