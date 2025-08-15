#!/bin/bash

# Phase 4 Authentication Migration Testing Script
# Executes comprehensive testing and validation for authentication overhaul

echo "🚀 ClassWaves Authentication Migration - Phase 4 Testing"
echo "========================================================="

# Set environment variables for testing
export NODE_ENV=test
export E2E_TEST_SECRET=test
export JEST_TIMEOUT=300000  # 5 minutes for comprehensive tests

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Check if backend is running
check_backend() {
    print_status $BLUE "🔍 Checking backend service status..."
    
    if curl -s http://localhost:3000/api/v1/health > /dev/null; then
        print_status $GREEN "✅ Backend service is running"
        return 0
    else
        print_status $YELLOW "⚠️ Backend service not running, starting..."
        return 1
    fi
}

# Start backend if needed
start_backend() {
    print_status $BLUE "🚀 Starting backend service for testing..."
    
    cd "$(dirname "$0")/.."
    
    # Start backend in background
    NODE_ENV=test E2E_TEST_SECRET=test npm run dev:server-only &
    BACKEND_PID=$!
    
    # Wait for backend to start
    for i in {1..30}; do
        if curl -s http://localhost:3000/api/v1/health > /dev/null; then
            print_status $GREEN "✅ Backend service started successfully"
            return 0
        fi
        sleep 2
        echo "Waiting for backend to start... ($i/30)"
    done
    
    print_status $RED "❌ Failed to start backend service"
    return 1
}

# Run Phase 4 tests
run_phase4_tests() {
    print_status $BLUE "⚡ Executing Phase 4 comprehensive testing..."
    
    cd "$(dirname "$0")/.."
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        print_status $BLUE "📦 Installing dependencies..."
        npm install
    fi
    
    # Run the Phase 4 test runner
    print_status $BLUE "🧪 Running Phase 4 test suite..."
    
    if npx ts-node src/__tests__/phase4/phase4-test-runner.ts; then
        print_status $GREEN "✅ Phase 4 testing completed successfully"
        return 0
    else
        print_status $RED "❌ Phase 4 testing failed"
        return 1
    fi
}

# Run individual test suites for debugging
run_individual_tests() {
    print_status $BLUE "🔍 Running individual test suites for detailed results..."
    
    cd "$(dirname "$0")/.."
    
    # Performance Tests
    print_status $BLUE "⚡ Running Performance Tests..."
    if npx jest src/__tests__/phase4/auth-performance-load.test.ts --verbose; then
        print_status $GREEN "✅ Performance tests passed"
    else
        print_status $RED "❌ Performance tests failed"
    fi
    
    # Security Tests  
    print_status $BLUE "🔒 Running Security Tests..."
    if npx jest src/__tests__/phase4/auth-security-validation.test.ts --verbose; then
        print_status $GREEN "✅ Security tests passed"
    else
        print_status $RED "❌ Security tests failed"
    fi
    
    # Reliability Tests
    print_status $BLUE "🛡️ Running Reliability Tests..."
    if npx jest src/__tests__/phase4/auth-reliability-validation.test.ts --verbose; then
        print_status $GREEN "✅ Reliability tests passed"
    else
        print_status $RED "❌ Reliability tests failed"
    fi
}

# Cleanup function
cleanup() {
    if [ ! -z "$BACKEND_PID" ]; then
        print_status $BLUE "🧹 Cleaning up background processes..."
        kill $BACKEND_PID 2>/dev/null || true
    fi
}

# Set up cleanup trap
trap cleanup EXIT

# Main execution
main() {
    local run_individual=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --individual)
                run_individual=true
                shift
                ;;
            --help)
                echo "Usage: $0 [--individual] [--help]"
                echo "  --individual  Run individual test suites separately"
                echo "  --help        Show this help message"
                exit 0
                ;;
            *)
                print_status $YELLOW "Unknown option: $1"
                shift
                ;;
        esac
    done
    
    # Check and start backend if needed
    if ! check_backend; then
        if ! start_backend; then
            print_status $RED "❌ Cannot proceed without backend service"
            exit 1
        fi
    fi
    
    # Run tests
    if [ "$run_individual" = true ]; then
        run_individual_tests
    else
        if ! run_phase4_tests; then
            print_status $RED "❌ Phase 4 testing failed"
            exit 1
        fi
    fi
    
    print_status $GREEN "🎉 Phase 4 authentication migration testing completed"
}

# Execute main function
main "$@"
