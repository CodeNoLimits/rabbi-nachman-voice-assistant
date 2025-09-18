#!/bin/bash

# 🧪 Automated Testing System for Self-Verification
# Tests all functionalities without user intervention

set -e

echo "🧪 Starting Automated Testing System"
echo "===================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results tracking
TESTS_PASSED=0
TESTS_FAILED=0
TEST_RESULTS=()

# Function to run a test and track results
run_test() {
    local test_name="$1"
    local test_command="$2"
    local expected_status="$3"

    echo -n "🔍 Testing: $test_name... "

    if eval "$test_command" > /dev/null 2>&1; then
        if [ "$expected_status" = "success" ]; then
            echo -e "${GREEN}✅ PASSED${NC}"
            ((TESTS_PASSED++))
            TEST_RESULTS+=("✅ $test_name: PASSED")
        else
            echo -e "${RED}❌ FAILED (unexpected success)${NC}"
            ((TESTS_FAILED++))
            TEST_RESULTS+=("❌ $test_name: FAILED (unexpected success)")
        fi
    else
        if [ "$expected_status" = "fail" ]; then
            echo -e "${GREEN}✅ PASSED (expected failure)${NC}"
            ((TESTS_PASSED++))
            TEST_RESULTS+=("✅ $test_name: PASSED (expected failure)")
        else
            echo -e "${RED}❌ FAILED${NC}"
            ((TESTS_FAILED++))
            TEST_RESULTS+=("❌ $test_name: FAILED")
        fi
    fi
}

# Function to test HTTP endpoints
test_endpoint() {
    local endpoint="$1"
    local method="$2"
    local expected_status="$3"
    local data="$4"

    if [ "$method" = "POST" ] && [ ! -z "$data" ]; then
        curl -s -X POST -H "Content-Type: application/json" \
             -d "$data" "http://localhost:3000$endpoint" \
             --max-time 10 --fail > /dev/null
    else
        curl -s "http://localhost:3000$endpoint" --max-time 10 --fail > /dev/null
    fi
}

echo "🚀 Starting test server in background..."
node server.js > server-test.log 2>&1 &
SERVER_PID=$!

# Wait for server to start
sleep 3

echo "🔧 Running Infrastructure Tests..."
echo "=================================="

# Test 1: Server is running
run_test "Server Startup" "pgrep -f 'node server.js'" "success"

# Test 2: Database connection
run_test "Database Connection" "psql -d rabbi_nachman_db -c 'SELECT 1;'" "success"

# Test 3: Basic HTTP response
run_test "HTTP Server Response" "test_endpoint '/' 'GET' '200'" "success"

echo ""
echo "📚 Running API Endpoint Tests..."
echo "================================"

# Test 4: API Status endpoint
run_test "API Status Endpoint" "test_endpoint '/api/status' 'GET' '200'" "success"

# Test 5: Books listing endpoint
run_test "Books Listing Endpoint" "test_endpoint '/api/books' 'GET' '200'" "success"

# Test 6: Query endpoint with test question
test_data='{"question":"Test simple"}'
run_test "Query Endpoint" "test_endpoint '/api/query/ask' 'POST' '200' '$test_data'" "success"

echo ""
echo "🔍 Running Data Validation Tests..."
echo "=================================="

# Test 7: Check if books exist in database
run_test "Books in Database" "psql -d rabbi_nachman_db -c 'SELECT COUNT(*) FROM books;' | grep -q '[1-9]'" "success"

# Test 8: Check if chunks exist
run_test "Chunks in Database" "psql -d rabbi_nachman_db -c 'SELECT COUNT(*) FROM chunks;' | grep -q '[1-9]'" "success"

# Test 9: Check master index
run_test "Master Index Exists" "[ -f 'data/master-index.json' ]" "success"

echo ""
echo "🎤 Running Voice/Audio Tests..."
echo "==============================="

# Test 10: Voice endpoint exists
run_test "Voice Endpoint" "test_endpoint '/api/voice/stt' 'POST' '200'" "fail" # Expected to fail without audio data

echo ""
echo "🌐 Running Frontend Tests..."
echo "============================"

# Test 11: Main page loads
run_test "Main Page Load" "test_endpoint '/' 'GET' '200'" "success"

# Test 12: Working interface loads
run_test "Working Interface Load" "test_endpoint '/index-working.html' 'GET' '200'" "success"

# Test 13: Debug page loads
run_test "Debug Page Load" "test_endpoint '/debug.html' 'GET' '200'" "success"

echo ""
echo "⚡ Running Performance Tests..."
echo "=============================="

# Test 14: Query response time (under 5 seconds)
start_time=$(date +%s)
if test_endpoint "/api/query/ask" "POST" "200" '{"question":"joie"}'; then
    end_time=$(date +%s)
    duration=$((end_time - start_time))
    if [ $duration -lt 5 ]; then
        echo -e "🔍 Testing: Query Response Time... ${GREEN}✅ PASSED ($duration seconds)${NC}"
        ((TESTS_PASSED++))
        TEST_RESULTS+=("✅ Query Response Time: PASSED ($duration seconds)")
    else
        echo -e "🔍 Testing: Query Response Time... ${RED}❌ FAILED (${duration}s > 5s)${NC}"
        ((TESTS_FAILED++))
        TEST_RESULTS+=("❌ Query Response Time: FAILED (${duration}s > 5s)")
    fi
else
    echo -e "🔍 Testing: Query Response Time... ${RED}❌ FAILED (endpoint error)${NC}"
    ((TESTS_FAILED++))
    TEST_RESULTS+=("❌ Query Response Time: FAILED (endpoint error)")
fi

echo ""
echo "🔧 Cleaning up..."
kill $SERVER_PID 2>/dev/null || true
rm -f server-test.log

echo ""
echo "📊 Test Results Summary"
echo "======================"
echo -e "✅ Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "❌ Tests Failed: ${RED}$TESTS_FAILED${NC}"

total_tests=$((TESTS_PASSED + TESTS_FAILED))
if [ $total_tests -gt 0 ]; then
    success_rate=$((TESTS_PASSED * 100 / total_tests))
    echo -e "📈 Success Rate: $success_rate%"
fi

echo ""
echo "📋 Detailed Results:"
echo "==================="
for result in "${TEST_RESULTS[@]}"; do
    echo "$result"
done

echo ""

# Save results to file
cat > test-results.json << EOF
{
    "timestamp": "$(date -Iseconds)",
    "total_tests": $total_tests,
    "passed": $TESTS_PASSED,
    "failed": $TESTS_FAILED,
    "success_rate": $success_rate,
    "results": [
$(IFS=$'\n'; echo "${TEST_RESULTS[*]}" | sed 's/^/        "/' | sed 's/$/",/' | sed '$s/,$//')
    ]
}
EOF

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed! Application is ready for production.${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠️ Some tests failed. Please review and fix issues before deployment.${NC}"
    exit 1
fi