#!/bin/bash
# Quick script to check test progress

echo "=== Test Process Status ==="
if ps aux | grep -E "test-streaming-e2e.sh" | grep -v grep > /dev/null; then
    PID=$(pgrep -f "test-streaming-e2e.sh" | head -1)
    ELAPSED=$(ps -o etime= -p $PID 2>/dev/null | tr -d ' ')
    echo "✅ Tests are RUNNING (PID: $PID, Elapsed: $ELAPSED)"
else
    echo "❌ Tests are NOT running"
    exit 1
fi

echo ""
echo "=== Service Status ==="
if curl -s http://localhost:3005/streaming/rooms > /dev/null 2>&1; then
    echo "✅ Streaming service is responding"
else
    echo "❌ Streaming service is NOT responding"
fi

echo ""
echo "=== Recent Test Activity (last 10 lines) ==="
tail -10 /tmp/streaming-service-test.log 2>/dev/null | grep -E "Test [0-9]+:|TEST SUMMARY" || echo "No test markers found in recent logs"

echo ""
echo "=== Test Count ==="
TOTAL_TESTS=$(grep -c "Test [0-9]:" /Users/arya.prakash/backend-hmm/tests/streaming-service/test-streaming-e2e.sh 2>/dev/null || echo "67")
COMPLETED=$(grep -E "Test [0-9]+:" /tmp/streaming-service-test.log 2>/dev/null | wc -l | tr -d ' ')
echo "Total tests in script: ~$TOTAL_TESTS"
echo "Tests completed so far: $COMPLETED"

echo ""
echo "=== Why it's taking time ==="
echo "The test script has:"
echo "  - ~67 tests to run"
echo "  - Many sleep delays (1-2 seconds each) between tests"
echo "  - WebSocket connections that need time to establish"
echo "  - Database operations"
echo ""
echo "Estimated total time: 5-10 minutes for all tests"
