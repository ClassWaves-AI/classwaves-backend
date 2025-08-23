#!/bin/bash

echo "🔍 Running ClassWaves API Health Audit..."
echo "=========================================="

# Check if backend is running
if ! curl -s http://localhost:3000/api/v1/health > /dev/null; then
    echo "❌ Backend server is not running on port 3000"
    echo "Please start the backend server first: npm run dev"
    exit 1
fi

echo "✅ Backend server is running"
echo ""

# Get a valid test token automatically
echo "🔑 Getting valid test token for API audit..."
TOKEN_RESPONSE=$(curl -s -X POST http://localhost:3000/api/v1/auth/generate-test-token \
  -H "Content-Type: application/json" \
  -d '{"secretKey": "test-secret-key"}')

if echo "$TOKEN_RESPONSE" | grep -q '"success":true'; then
    # Extract access token from response
    ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
    
    # If not found in root, try tokens.accessToken
    if [ -z "$ACCESS_TOKEN" ]; then
        ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"tokens":{"accessToken":"[^"]*"' | cut -d'"' -f6)
    fi
    
    if [ -n "$ACCESS_TOKEN" ]; then
        echo "✅ Test token obtained successfully"
        echo "Token: ${ACCESS_TOKEN:0:50}..."
        echo ""
        
        # Set environment variable for the audit
        export API_AUDIT_TOKEN="$ACCESS_TOKEN"
        echo "🔧 API_AUDIT_TOKEN environment variable set"
        echo ""
        
        # Run the API health audit with the token
        echo "🧪 Starting comprehensive API health audit with valid token..."
        cd "$(dirname "$0")/.."
        npx ts-node src/scripts/api-health-audit.ts
        
    else
        echo "❌ Failed to extract access token from response"
        echo "Response: $TOKEN_RESPONSE"
        exit 1
    fi
else
    echo "❌ Failed to get test token"
    echo "Response: $TOKEN_RESPONSE"
    exit 1
fi

echo ""
echo "🎉 API health audit completed with valid token!"
echo "Check the output above for any issues that need to be addressed."
