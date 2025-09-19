#!/bin/bash

echo "🔑 Getting Test Token for API Audit..."
echo "======================================"

# Check if backend is running
if ! curl -s http://localhost:3000/api/v1/health > /dev/null; then
    echo "❌ Backend server is not running on port 3000"
    echo "Please start the backend server first: npm run dev"
    exit 1
fi

echo "✅ Backend server is running"
echo ""

# Get a test token
echo "🔑 Requesting test token..."
TOKEN_RESPONSE=$(curl -s -X POST http://localhost:3000/api/v1/auth/test-token \
  -H "Content-Type: application/json" \
  -d '{"email": "test@classwaves.ai", "role": "teacher"}')

if echo "$TOKEN_RESPONSE" | grep -q '"success":true'; then
    # Extract token from response
    TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    
    if [ -n "$TOKEN" ]; then
        echo "✅ Test token obtained successfully"
        echo "Token: $TOKEN"
        echo ""
        
        # Set environment variable for the audit
        export API_AUDIT_TOKEN="$TOKEN"
        echo "🔧 API_AUDIT_TOKEN environment variable set"
        echo ""
        
        # Run the API audit with the token
        echo "🧪 Running API health audit with valid token..."
        cd "$(dirname "$0")/.."
        npx ts-node src/scripts/api-health-audit.ts
        
    else
        echo "❌ Failed to extract token from response"
        echo "Response: $TOKEN_RESPONSE"
        exit 1
    fi
else
    echo "❌ Failed to get test token"
    echo "Response: $TOKEN_RESPONSE"
    exit 1
fi

echo ""
echo "🎉 API audit completed with valid token!"
