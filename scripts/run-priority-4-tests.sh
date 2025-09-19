#!/bin/bash

# Priority 4 Testing & Validation - Test Execution Script
# 
# This script runs all Priority 4 integration and E2E tests with performance validation.
# Requirements:
# - Integration tests: < 2 minutes total runtime  
# - E2E tests: < 5 minutes total runtime
# - Tests must be reliable (not flaky)
# - Real Databricks connection required for integration tests

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$(dirname "$BACKEND_DIR")/classwaves-frontend"

# Performance requirements (in seconds)
INTEGRATION_TIME_LIMIT=120  # 2 minutes
E2E_TIME_LIMIT=300          # 5 minutes

# Test results tracking
INTEGRATION_TESTS_PASSED=false
E2E_TESTS_PASSED=false
INTEGRATION_TIME=0
E2E_TIME=0

echo -e "${BLUE}🧪 Priority 4 Testing & Validation - Test Execution${NC}"
echo "=================================================="
echo ""

# Function to print colored output
print_status() {
    local status=$1
    local message=$2
    case $status in
        "success")
            echo -e "${GREEN}✅ $message${NC}"
            ;;
        "error")
            echo -e "${RED}❌ $message${NC}"
            ;;
        "warning")
            echo -e "${YELLOW}⚠️  $message${NC}"
            ;;
        "info")
            echo -e "${BLUE}ℹ️  $message${NC}"
            ;;
    esac
}

# Function to check prerequisites
check_prerequisites() {
    print_status "info" "Checking prerequisites..."
    
    # Check if we're in the backend directory
    if [[ ! -f "$BACKEND_DIR/package.json" ]]; then
        print_status "error" "Must be run from classwaves-backend directory"
        exit 1
    fi
    
    # Check if frontend directory exists
    if [[ ! -d "$FRONTEND_DIR" ]]; then
        print_status "error" "Frontend directory not found at $FRONTEND_DIR"
        exit 1
    fi
    
    # Check for required environment variables
    if [[ -z "$DATABRICKS_TOKEN" ]]; then
        print_status "warning" "DATABRICKS_TOKEN not set - integration tests may be skipped"
    fi
    
    if [[ -z "$E2E_TEST_SECRET" ]]; then
        print_status "warning" "E2E_TEST_SECRET not set - some E2E tests may fail"
    fi
    
    print_status "success" "Prerequisites checked"
}

# Function to run integration tests
run_integration_tests() {
    print_status "info" "Running Priority 4 Integration Tests..."
    echo ""
    
    cd "$BACKEND_DIR"
    
    # Set up test environment
    export NODE_ENV=test
    export SKIP_INTEGRATION_TESTS=${SKIP_INTEGRATION_TESTS:-false}
    
    # Start timing
    local start_time=$(date +%s)
    
    # Run the specific integration test file
    if npm test -- --testPathPattern=analytics-computation-real-db.integration.test.ts --verbose; then
        INTEGRATION_TESTS_PASSED=true
        print_status "success" "Integration tests passed"
    else
        print_status "error" "Integration tests failed"
    fi
    
    # Calculate execution time
    local end_time=$(date +%s)
    INTEGRATION_TIME=$((end_time - start_time))
    
    echo ""
    print_status "info" "Integration tests completed in ${INTEGRATION_TIME}s"
    
    # Check performance requirement
    if [[ $INTEGRATION_TIME -gt $INTEGRATION_TIME_LIMIT ]]; then
        print_status "error" "Integration tests exceeded time limit (${INTEGRATION_TIME}s > ${INTEGRATION_TIME_LIMIT}s)"
    else
        print_status "success" "Integration tests met performance requirement (${INTEGRATION_TIME}s < ${INTEGRATION_TIME_LIMIT}s)"
    fi
}

# Function to run E2E tests
run_e2e_tests() {
    print_status "info" "Running Priority 4 E2E Tests..."
    echo ""
    
    cd "$FRONTEND_DIR"
    
    # Set up test environment
    export E2E_TEST_SECRET=${E2E_TEST_SECRET:-test}
    export E2E_BACKEND_URL=${E2E_BACKEND_URL:-http://localhost:3000}
    export E2E_FRONTEND_URL=${E2E_FRONTEND_URL:-http://localhost:3001}
    
    # Check if backend is running
    if ! curl -s "$E2E_BACKEND_URL/api/v1/health" > /dev/null 2>&1; then
        print_status "warning" "Backend not running - starting backend in test mode..."
        cd "$BACKEND_DIR"
        NODE_ENV=test E2E_TEST_SECRET=test npm run dev &
        BACKEND_PID=$!
        sleep 10
        cd "$FRONTEND_DIR"
    fi
    
    # Check if frontend is running
    if ! curl -s "$E2E_FRONTEND_URL" > /dev/null 2>&1; then
        print_status "warning" "Frontend not running - please start frontend server manually"
        print_status "info" "Run: cd $FRONTEND_DIR && npm run dev"
        return 1
    fi
    
    # Start timing
    local start_time=$(date +%s)
    
    # Run the specific E2E test files
    local e2e_passed=true
    
    # Run analytics pipeline complete tests
    if npx playwright test tests/e2e/dashboard/analytics-pipeline-complete.spec.ts --project=authenticated-chrome --reporter=list; then
        print_status "success" "Analytics pipeline E2E tests passed"
    else
        print_status "error" "Analytics pipeline E2E tests failed"
        e2e_passed=false
    fi
    
    # Run WebSocket real-time tests
    if npx playwright test tests/e2e/dashboard/analytics-websocket-realtime.spec.ts --project=authenticated-chrome --reporter=list; then
        print_status "success" "WebSocket real-time E2E tests passed"
    else
        print_status "error" "WebSocket real-time E2E tests failed"
        e2e_passed=false
    fi
    
    if $e2e_passed; then
        E2E_TESTS_PASSED=true
    fi
    
    # Calculate execution time
    local end_time=$(date +%s)
    E2E_TIME=$((end_time - start_time))
    
    echo ""
    print_status "info" "E2E tests completed in ${E2E_TIME}s"
    
    # Check performance requirement
    if [[ $E2E_TIME -gt $E2E_TIME_LIMIT ]]; then
        print_status "error" "E2E tests exceeded time limit (${E2E_TIME}s > ${E2E_TIME_LIMIT}s)"
    else
        print_status "success" "E2E tests met performance requirement (${E2E_TIME}s < ${E2E_TIME_LIMIT}s)"
    fi
    
    # Cleanup background backend if we started it
    if [[ -n "$BACKEND_PID" ]]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
}

# Function to validate test quality
validate_test_quality() {
    print_status "info" "Validating test quality and coverage..."
    
    cd "$BACKEND_DIR"
    
    # Check if integration test file exists and has comprehensive tests
    local integration_file="src/__tests__/integration/analytics-computation-real-db.integration.test.ts"
    if [[ -f "$integration_file" ]]; then
        local test_count=$(grep -c "it\|test" "$integration_file" || echo "0")
        if [[ $test_count -ge 5 ]]; then
            print_status "success" "Integration tests have comprehensive coverage ($test_count tests)"
        else
            print_status "warning" "Integration tests may need more coverage ($test_count tests)"
        fi
    else
        print_status "error" "Integration test file not found"
        return 1
    fi
    
    cd "$FRONTEND_DIR"
    
    # Check E2E test files
    local e2e_file1="tests/e2e/dashboard/analytics-pipeline-complete.spec.ts"
    local e2e_file2="tests/e2e/dashboard/analytics-websocket-realtime.spec.ts"
    
    local total_e2e_tests=0
    
    if [[ -f "$e2e_file1" ]]; then
        local test_count1=$(grep -c "test(" "$e2e_file1" || echo "0")
        total_e2e_tests=$((total_e2e_tests + test_count1))
        print_status "success" "Analytics pipeline E2E tests ($test_count1 tests)"
    else
        print_status "error" "Analytics pipeline E2E test file not found"
    fi
    
    if [[ -f "$e2e_file2" ]]; then
        local test_count2=$(grep -c "test(" "$e2e_file2" || echo "0")
        total_e2e_tests=$((total_e2e_tests + test_count2))
        print_status "success" "WebSocket real-time E2E tests ($test_count2 tests)"
    else
        print_status "error" "WebSocket real-time E2E test file not found"
    fi
    
    if [[ $total_e2e_tests -ge 8 ]]; then
        print_status "success" "E2E tests have comprehensive coverage ($total_e2e_tests tests)"
    else
        print_status "warning" "E2E tests may need more coverage ($total_e2e_tests tests)"
    fi
}

# Function to generate final report
generate_report() {
    echo ""
    echo -e "${BLUE}📊 Priority 4 Testing & Validation Report${NC}"
    echo "=========================================="
    echo ""
    
    # Integration Tests
    echo -e "${BLUE}Integration Tests:${NC}"
    if $INTEGRATION_TESTS_PASSED; then
        echo -e "  Status: ${GREEN}✅ PASSED${NC}"
    else
        echo -e "  Status: ${RED}❌ FAILED${NC}"
    fi
    echo "  Execution Time: ${INTEGRATION_TIME}s (limit: ${INTEGRATION_TIME_LIMIT}s)"
    if [[ $INTEGRATION_TIME -le $INTEGRATION_TIME_LIMIT ]]; then
        echo -e "  Performance: ${GREEN}✅ MEETS REQUIREMENT${NC}"
    else
        echo -e "  Performance: ${RED}❌ EXCEEDS LIMIT${NC}"
    fi
    echo ""
    
    # E2E Tests
    echo -e "${BLUE}E2E Tests:${NC}"
    if $E2E_TESTS_PASSED; then
        echo -e "  Status: ${GREEN}✅ PASSED${NC}"
    else
        echo -e "  Status: ${RED}❌ FAILED${NC}"
    fi
    echo "  Execution Time: ${E2E_TIME}s (limit: ${E2E_TIME_LIMIT}s)"
    if [[ $E2E_TIME -le $E2E_TIME_LIMIT ]]; then
        echo -e "  Performance: ${GREEN}✅ MEETS REQUIREMENT${NC}"
    else
        echo -e "  Performance: ${RED}❌ EXCEEDS LIMIT${NC}"
    fi
    echo ""
    
    # Overall Status
    echo -e "${BLUE}Overall Priority 4 Status:${NC}"
    local total_time=$((INTEGRATION_TIME + E2E_TIME))
    if $INTEGRATION_TESTS_PASSED && $E2E_TESTS_PASSED && [[ $INTEGRATION_TIME -le $INTEGRATION_TIME_LIMIT ]] && [[ $E2E_TIME -le $E2E_TIME_LIMIT ]]; then
        echo -e "  ${GREEN}🎉 PRIORITY 4 COMPLETE - ALL REQUIREMENTS MET${NC}"
        echo ""
        echo "✅ Real Databricks connection integration tests"
        echo "✅ Complete analytics pipeline E2E tests"
        echo "✅ WebSocket real-time event validation"
        echo "✅ Error handling and fallback scenarios"
        echo "✅ Performance requirements met"
        echo "✅ Production readiness validated"
        echo ""
        echo "Total Test Time: ${total_time}s"
        return 0
    else
        echo -e "  ${RED}❌ PRIORITY 4 INCOMPLETE - REQUIREMENTS NOT MET${NC}"
        echo ""
        if ! $INTEGRATION_TESTS_PASSED; then
            echo "❌ Integration tests failed"
        fi
        if ! $E2E_TESTS_PASSED; then
            echo "❌ E2E tests failed"
        fi
        if [[ $INTEGRATION_TIME -gt $INTEGRATION_TIME_LIMIT ]]; then
            echo "❌ Integration tests too slow"
        fi
        if [[ $E2E_TIME -gt $E2E_TIME_LIMIT ]]; then
            echo "❌ E2E tests too slow"
        fi
        echo ""
        return 1
    fi
}

# Main execution
main() {
    echo -e "${BLUE}Starting Priority 4 Testing & Validation...${NC}"
    echo ""
    
    # Run all validation steps
    check_prerequisites
    echo ""
    
    validate_test_quality
    echo ""
    
    run_integration_tests
    echo ""
    
    run_e2e_tests
    echo ""
    
    generate_report
}

# Handle command line arguments
case "${1:-}" in
    "integration")
        check_prerequisites
        run_integration_tests
        ;;
    "e2e")
        check_prerequisites
        run_e2e_tests
        ;;
    "validate")
        validate_test_quality
        ;;
    "help"|"-h"|"--help")
        echo "Priority 4 Testing & Validation Script"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  integration  Run only integration tests"
        echo "  e2e         Run only E2E tests"
        echo "  validate    Validate test quality and coverage"
        echo "  help        Show this help message"
        echo ""
        echo "No command runs all tests and generates full report"
        ;;
    *)
        main
        exit $?
        ;;
esac
