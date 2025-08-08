import axios from 'axios';
import { config } from 'dotenv';
config();

const API_BASE_URL = `http://localhost:${process.env.PORT || 3001}/api/v1`;

async function testAuthFlow() {
  console.log('🧪 Testing ClassWaves Authentication Flow\n');
  
  try {
    // Step 1: Test health endpoint
    console.log('1️⃣ Testing health endpoint...');
    const healthResponse = await axios.get(`${API_BASE_URL}/health`);
    console.log('✅ Health check passed:', healthResponse.data);
    console.log('');
    
    // Step 2: Simulate Google OAuth callback
    console.log('2️⃣ Testing Google OAuth callback...');
    console.log('ℹ️  In production, this would be called by Google after user consent');
    console.log('ℹ️  For testing, we need a valid authorization code from Google OAuth flow');
    console.log('');
    
    // Step 3: Test with mock data (will fail, but shows the flow)
    console.log('3️⃣ Testing with mock authorization code (expected to fail)...');
    try {
      const authResponse = await axios.post(`${API_BASE_URL}/auth/google`, {
        code: 'mock_authorization_code_for_testing'
      });
      console.log('✅ Auth response:', authResponse.data);
    } catch (error: any) {
      console.log('❌ Auth failed (expected with mock code):', error.response?.data || error.message);
      console.log('');
      console.log('💡 To test real authentication:');
      console.log('   1. Set up Google OAuth consent screen in Google Cloud Console');
      console.log('   2. Add http://localhost:3000/auth/callback to authorized redirect URIs');
      console.log('   3. Create a frontend that initiates the OAuth flow');
      console.log('   4. Use the real authorization code returned by Google');
    }
    
    console.log('');
    console.log('📋 Authentication Flow Summary:');
    console.log('   1. User clicks "Sign in with Google" on frontend');
    console.log('   2. Frontend redirects to Google OAuth consent screen');
    console.log('   3. User approves and Google redirects back with authorization code');
    console.log('   4. Frontend sends code to POST /api/v1/auth/google');
    console.log('   5. Backend exchanges code for tokens and creates session');
    console.log('   6. Backend returns ClassWaves JWT tokens');
    console.log('');
    console.log('🔗 OAuth URLs:');
    console.log(`   Authorization URL: https://accounts.google.com/o/oauth2/v2/auth?`);
    console.log(`     client_id=${process.env.GOOGLE_CLIENT_ID}`);
    console.log(`     &redirect_uri=${encodeURIComponent(process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback')}`);
    console.log(`     &response_type=code`);
    console.log(`     &scope=openid%20email%20profile`);
    console.log(`     &access_type=offline`);
    console.log(`     &prompt=consent`);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testAuthFlow().catch(console.error);