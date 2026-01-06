# Interactive Streaming Service Test Tool

## Quick Start

### 1. Start the Streaming Service ⚠️ **REQUIRED**

**IMPORTANT**: The service MUST be running before testing. If "Test Connection" shows "Disconnected", the service is not running.

```bash
cd apps/streaming-service
TEST_MODE=true npm run start:dev
```

**Wait until you see:**
```
⚠️  TEST MODE ENABLED - Authentication is bypassed
🚀 Application is running on: http://localhost:3005
WebSocket gateway initialized at /streaming/ws
```

**Keep this terminal open** - the service needs to keep running while you test.

### 2. Open the Test Tool

**Important**: If you see CORS errors, use a local web server instead of opening the file directly.

**Option A: Using a local web server (Recommended - avoids CORS issues)**

```bash
# From the backend-hmm root directory
cd /Users/arya.prakash/backend-hmm

# Start a simple HTTP server
python3 -m http.server 8000

# Then open in browser:
# http://localhost:8000/tests/streaming-service/interactive-test.html
```

**Option B: Open directly (may have CORS issues)**

```bash
# macOS
open tests/streaming-service/interactive-test.html

# Linux
xdg-open tests/streaming-service/interactive-test.html
```

**Note**: If you see "CORS error" when testing connection, use Option A instead.

### 3. Test Connection

The tool will automatically test the connection when loaded. You should see:
- ✅ Connection Status: **Connected** (green badge)
- ✅ Log message: "Connection successful! Service is running."

If connection fails:
- Ensure service is running
- Check URL is `http://localhost:3005`
- Verify TEST_MODE is enabled

## Features

### 🏠 Room Management
- Create rooms with 2-4 users
- Get room information
- View all created rooms

### 👤 User Connection
- Connect users via WebSocket
- Join rooms as participants
- Start broadcasting
- Join as viewers

### 💬 Chat
- Send chat messages in real-time
- View chat history
- Messages broadcasted to all room participants

### 📋 Dares
- Get list of available dares
- View dare details

### ⚡ Quick Tests
- Pre-configured test scenarios
- One-click test execution

## Basic Test Flow

1. **Create Room**
   - Enter user IDs: `user1, user2`
   - Click "Create Room"
   - Note the Room ID

2. **Connect Users**
   - Enter User ID: `user1`
   - Click "Connect User"
   - Enter Room ID
   - Click "Join Room"

3. **Send Messages**
   - Type a message
   - Click "Send Chat Message"
   - View in chat history

## Files

- `interactive-test.html` - Browser-based test tool
- `INTERACTIVE_TEST_GUIDE.md` - Detailed test cases and instructions
- `README_INTERACTIVE_TEST.md` - This file (quick reference)

## Test Cases

See `INTERACTIVE_TEST_GUIDE.md` for complete test cases:

1. Basic Room Creation & Join Flow
2. Chat Functionality
3. Broadcasting Flow
4. Dares Feature
5. Multiple Users & Concurrent Operations
6. Error Handling
7. Room Information & State

## Troubleshooting

### ❌ "Test Connection" Shows Disconnected

**Common causes and solutions:**

1. **CORS Error (Most Common)**
   - If you see "CORS error" or "cross-origin" in logs
   - **Solution**: Use a local web server instead of opening file directly
   ```bash
   # From backend-hmm root:
   python3 -m http.server 8000
   # Then open: http://localhost:8000/tests/streaming-service/interactive-test.html
   ```
   Or use the provided script:
   ```bash
   ./tests/streaming-service/start-local-server.sh
   ```

2. **Service Not Running**
   - **Solution**: Start the service first

1. **Open a new terminal** (keep it open - service must keep running)
2. **Start the service:**
   ```bash
   cd apps/streaming-service
   TEST_MODE=true npm run start:dev
   ```
3. **Wait for startup messages** (may take 10-30 seconds)
4. **Verify it's running:**
   ```bash
   # In another terminal, check if port 3005 is in use:
   lsof -i :3005
   # Or test directly:
   curl http://localhost:3005/streaming/rooms/test-123
   ```
5. **Then click "Test Connection" again** in the browser

**Other Issues:**

- **Service running?** Check: `lsof -i :3005` or `curl http://localhost:3005/streaming/rooms/test`
- **TEST_MODE enabled?** Check service logs for "TEST MODE ENABLED"
- **Correct URL?** Default is `http://localhost:3005` (check in the tool's Connection Settings)
- **Database error?** Check `apps/streaming-service/.env` has correct `DATABASE_URL`
- **Browser console errors?** Press F12 → Console tab to see detailed errors

**WebSocket Not Connecting?**
- Check WebSocket URL: `ws://localhost:3005/streaming/ws`
- Open browser console (F12) for errors
- Ensure user ID is provided in query: `?userId=user1`

**Messages Not Received?**
- Is user connected? Check status badge
- Has user joined room? Must join before sending messages
- Check server logs for errors

## For Frontend Developers

This tool demonstrates:
- WebSocket connection flow
- Message format and types
- REST API usage
- State management patterns
- Error handling

Use this as a reference for frontend integration!

---

**Need Help?** See `INTERACTIVE_TEST_GUIDE.md` for detailed instructions.

