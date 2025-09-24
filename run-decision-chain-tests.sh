#!/bin/bash

# Decision Chain Monitoring Test Runner
# This script runs all tests for the decision chain monitoring implementation

echo "🧪 Running Decision Chain Monitoring Tests..."
echo "================================================"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to run a test file and check results
run_test() {
    local test_file=$1
    local test_name=$2
    
    echo -e "${YELLOW}Running $test_name...${NC}"
    
    if npm test -- --testPathPattern="$test_file" --silent; then
        echo -e "${GREEN}✅ $test_name passed${NC}"
        return 0
    else
        echo -e "${RED}❌ $test_name failed${NC}"
        return 1
    fi
}

# Track overall test results
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Run individual test files
echo -e "\n${YELLOW}Testing Decision Chain Monitor...${NC}"
TOTAL_TESTS=$((TOTAL_TESTS + 1))
if run_test "decision-chain-monitor.test.ts" "Decision Chain Monitor Tests"; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

echo -e "\n${YELLOW}Testing Monitoring Dashboard API...${NC}"
TOTAL_TESTS=$((TOTAL_TESTS + 1))
if run_test "monitoring-dashboard-api.test.ts" "Monitoring Dashboard API Tests"; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

echo -e "\n${YELLOW}Testing Recommendation API with Decision Chains...${NC}"
TOTAL_TESTS=$((TOTAL_TESTS + 1))
if run_test "recommendation-api-decision-chain.test.ts" "Recommendation API Decision Chain Tests"; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Run all tests together
echo -e "\n${YELLOW}Running all tests together...${NC}"
echo "================================================"

# Summary
echo -e "\n${YELLOW}Test Summary:${NC}"
echo "================================================"
echo -e "Total Tests: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "\n${GREEN}🎉 All tests passed! Decision chain monitoring implementation is working correctly.${NC}"
    exit 0
else
    echo -e "\n${RED}❌ Some tests failed. Please review the output above.${NC}"
    exit 1
fi