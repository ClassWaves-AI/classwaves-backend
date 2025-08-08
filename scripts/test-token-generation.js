// Quick test script to validate the test token generation logic
const express = require('express');

// Use existing environment variables
if (!process.env.E2E_TEST_SECRET) {
  process.env.E2E_TEST_SECRET = 'test-secret-key';
}

const app = express();
app.use(express.json());

// Simple test route to validate the concept
app.post('/test-token', async (req, res) => {
  try {
    console.log('Test environment:', process.env.NODE_ENV);
    console.log('Request body:', req.body);
    
    const { secretKey } = req.body;
    
    // Validate environment
    if (process.env.NODE_ENV !== 'test') {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Endpoint not available in this environment',
      });
    }

    // Validate secret
    if (!process.env.E2E_TEST_SECRET || secretKey !== process.env.E2E_TEST_SECRET) {
      return res.status(401).json({
        error: 'INVALID_SECRET',
        message: 'Invalid test secret key',
      });
    }

    // Mock response
    res.json({
      success: true,
      message: 'Test token generation logic works!',
      environment: process.env.NODE_ENV,
      secretValidated: true
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: 'TEST_ERROR',
      message: error.message
    });
  }
});

const PORT = 3002;
app.listen(PORT, () => {
  console.log(`🧪 Test server running on http://localhost:${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔑 Secret key set: ${!!process.env.E2E_TEST_SECRET}`);
});
