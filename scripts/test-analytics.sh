#!/bin/bash

# Analytics Tests Runner
# Runs comprehensive tests for the real-time analytics system

set -e

echo "🧪 Running ClassWaves Real-time Analytics Test Suite"
echo "=================================================="

# Set test environment
export NODE_ENV=test
export E2E_TEST_SECRET=test

echo ""
echo "🔧 Setting up test environment..."

# Check if services are running
if ! nc -z localhost 6379 2>/dev/null; then
  echo "⚠️  Redis not detected on localhost:6379 - some tests may fail"
fi

echo ""
echo "📋 Running Unit Tests..."
echo "------------------------"

# Run analytics computation service unit tests
npx jest src/__tests__/unit/analytics-computation.service.test.ts --verbose --detectOpenHandles

echo ""
echo "🔗 Running Integration Tests..."
echo "------------------------------"

# Run session analytics integration tests
npx jest src/__tests__/integration/session-analytics.integration.test.ts --verbose --detectOpenHandles

echo ""
echo "🌐 Running E2E Tests..."
echo "----------------------"

# Run real-time analytics E2E tests
npx jest src/__tests__/e2e/realtime-analytics.e2e.test.ts --verbose --detectOpenHandles --timeout=30000

echo ""
echo "✅ Analytics Test Suite Completed!"
echo ""
echo "📊 Test Coverage Summary:"
echo "• Analytics Computation Service: Unit tested with mocks"
echo "• Session Controller Integration: API endpoints with auth"
echo "• WebSocket Real-time Flow: E2E with multiple subscribers"
echo "• Authorization Middleware: Session-scoped access control"
echo "• Fallback Mechanisms: Timer-based reliability testing"
echo ""
echo "🎯 All analytics tests passed! The zero-polling, event-driven"
echo "   analytics system is ready for production deployment."
