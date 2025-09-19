import axios from 'axios';
import { config } from 'dotenv';
import { logger } from '../utils/logger';
config();

const API_BASE_URL = `http://localhost:${process.env.PORT || 3001}/api/v1`;

async function testAuthFlow() {
  logger.debug('🧪 Testing ClassWaves Authentication Flow\n');
  
  try {
    // Step 1: Test health endpoint
    logger.debug('1️⃣ Testing health endpoint...');
    const healthResponse = await axios.get(`${API_BASE_URL}/health`);
    logger.debug('✅ Health check passed:', healthResponse.data);
    logger.debug('');
    
    // Step 2: Simulate Google OAuth callback
    logger.debug('2️⃣ Testing Google OAuth callback...');
    logger.debug('ℹ️  In production, this would be called by Google after user consent');
    logger.debug('ℹ️  For testing, we need a valid authorization code from Google OAuth flow');
    logger.debug('');
    
    // Step 3: Test with mock data (will fail, but shows the flow)
    logger.debug('3️⃣ Testing with mock authorization code (expected to fail)...');
    try {
      const authResponse = await axios.post(`${API_BASE_URL}/auth/google`, {
        code: 'mock_authorization_code_for_testing'
      });
      logger.debug('✅ Auth response:', authResponse.data);
    } catch (error: any) {
      logger.debug('❌ Auth failed (expected with mock code):', error.response?.data || error.message);
      logger.debug('');
      logger.debug('💡 To test real authentication:');
      logger.debug('   1. Set up Google OAuth consent screen in Google Cloud Console');
      logger.debug('   2. Add http://localhost:3000/auth/callback to authorized redirect URIs');
      logger.debug('   3. Create a frontend that initiates the OAuth flow');
      logger.debug('   4. Use the real authorization code returned by Google');
    }
    
    logger.debug('');
    logger.debug('📋 Authentication Flow Summary:');
    logger.debug('   1. User clicks "Sign in with Google" on frontend');
    logger.debug('   2. Frontend redirects to Google OAuth consent screen');
    logger.debug('   3. User approves and Google redirects back with authorization code');
    logger.debug('   4. Frontend sends code to POST /api/v1/auth/google');
    logger.debug('   5. Backend exchanges code for tokens and creates session');
    logger.debug('   6. Backend returns ClassWaves JWT tokens');
    logger.debug('');
    logger.debug('🔗 OAuth URLs:');
    logger.debug(`   Authorization URL: https://accounts.google.com/o/oauth2/v2/auth?`);
    logger.debug(`     client_id=${process.env.GOOGLE_CLIENT_ID}`);
    logger.debug(`     &redirect_uri=${encodeURIComponent(process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback')}`);
    logger.debug(`     &response_type=code`);
    logger.debug(`     &scope=openid%20email%20profile`);
    logger.debug(`     &access_type=offline`);
    logger.debug(`     &prompt=consent`);
    
  } catch (error) {
    logger.error('❌ Test failed:', error);
  }
}

// Run the test
testAuthFlow().catch(console.error);