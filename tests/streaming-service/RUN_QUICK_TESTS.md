# Quick Tests Guide

## Quick Tests (REST API Only - Run First)
These tests are fast (1-2 minutes total) and only use REST API calls:

**Test Numbers:** 1, 2, 3, 4, 5, 12, 15, 17, 23, 24, 27, 28, 29, 37, 38, 53, 60, 64, 65, 66, 67

**To run just these tests:**
The full test file runs all tests. For now, you can:
1. Run the full test file (it will complete all tests)
2. Or manually test specific endpoints using curl

## Complex Tests (WebSocket/Integration - Run Second)
These tests use WebSocket connections and take longer (5-10 minutes):

**Test Numbers:** 6-11, 13-14, 16, 18-22, 25-26, 30-36, 39-52, 54-59, 61-63

The test file structure makes it difficult to split automatically. All tests share variables and setup code.
