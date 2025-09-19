#!/usr/bin/env ts-node

import axios from 'axios';

async function testSessionStart() {
  try {
    console.log('🧪 Testing session start endpoint...');
    
    // Test the specific session that was failing
    const sessionId = 'fdaf27c9-3f1c-4a43-a67f-944feec428aa';
    
    // First, check the current session status
    console.log('📊 Checking current session status...');
    try {
      const statusResponse = await axios.get(`http://localhost:3000/api/v1/sessions/${sessionId}`);
      console.log('✅ Session status response:', {
        status: statusResponse.status,
        data: statusResponse.data
      });
    } catch (error: any) {
      console.log('⚠️ Could not check session status:', error.response?.data || error.message);
    }
    
    // Now try to start the session
    console.log('\n🚀 Attempting to start session...');
    try {
      const startResponse = await axios.post(`http://localhost:3000/api/v1/sessions/${sessionId}/start`);
      console.log('✅ Session start successful:', {
        status: startResponse.status,
        data: startResponse.data
      });
    } catch (error: any) {
      console.log('❌ Session start failed:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      
      if (error.response?.data?.error?.code === 'INVALID_SESSION_STATE') {
        console.log('\n🔍 Analysis: Session is already in an invalid state for starting');
        console.log('   This suggests the session status is not "created" or "paused"');
        console.log('   The session might already be "active" or in another state');
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

if (require.main === module) {
  testSessionStart().catch(console.error);
}
