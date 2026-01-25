# HTML Test Interfaces

This directory contains interactive HTML test interfaces for testing backend services through the API Gateway.

## Overview

These interfaces are designed to help frontend developers and QA testers interact with backend services using the same API Gateway endpoints that the frontend application uses. This ensures consistent testing and helps identify integration issues early.

## Available Interfaces

### Comprehensive Test Interface (Recommended)

**File:** `comprehensive-test-interface.html`

Complete web interface for testing the entire HMM Chat flow:
- **Setup**: Create comprehensive test data (20+ users), cleanup sessions
- **Discovery**: Get cards, raincheck, proceed with matches, mutual acceptance flow
- **Streaming**: Create rooms, send gifts, send dares, get chat history
- **Wallet**: Check balance, add coins, view transactions, gift history
- **Friends**: View friends list and friend requests

**Features:**
- Uses test endpoints that bypass authentication (`/test/` prefix)
- Shows match explanations and user status
- Creates variety of test data (22+ users across 6 cities)
- Tabbed interface for easy navigation
- Real-time status updates
- Mutual acceptance flow testing

**Usage:**
1. Ensure API Gateway is running on `http://localhost:3000`
2. Ensure all services are running (Discovery, Streaming, Wallet, User, Friend)
3. Open `comprehensive-test-interface.html` in a web browser
4. Go to "Setup" tab and create test users
5. Test the complete flow: Discovery → Match → Mutual Acceptance → Room → Gifts → Wallet → Friends

## Complete User Flow: Discovery to Streaming

### Step 1: Create Test Users

1. Open the HTML interface in your browser
2. Go to the **Setup** tab
3. Click **"🚀 Create Comprehensive Test Data (20+ Users)"**
   - This creates 22+ diverse users across 6 cities (Mumbai, Delhi, Bangalore, Pune, Chennai, Hyderabad)
   - Each user gets:
     - Complete profile with display picture
     - Location data (latitude/longitude)
     - Preferred city set
     - Status set to `AVAILABLE`
     - 10,000 coins in wallet
   - Users are distributed across cities for realistic testing

### Step 2: Discovery - Get Cards

1. Go to the **Discovery** tab
2. Enter your **User ID** (e.g., `test-user-1`)
3. Enter a **Session ID** (e.g., `session-1`)
4. Click **"🔄 Get Next Card"**
   - If the user doesn't exist, it will be auto-created with basic profile
   - A card will be displayed showing:
     - User's profile picture
     - Username, age, city
     - Current status (AVAILABLE, IN_SQUAD, etc.)
     - Match explanation (why you matched, score, reasons)
   - The current user's status is displayed at the top

### Step 3: Mutual Acceptance Flow (Two Users Accept)

The mutual acceptance flow requires **both users to click "Proceed"** before entering streaming:

#### Option A: Manual Testing (Two Browser Tabs/Windows)

1. **Tab 1 - User 1:**
   - Set User ID: `test-user-1`
   - Click "Get Next Card"
   - When you see `test-user-2`'s card, click **"✅ Proceed"**
   - You'll see: `"✅ You accepted! Waiting for test-user-2 to accept..."`

2. **Tab 2 - User 2:**
   - Set User ID: `test-user-2`
   - Click "Get Next Card"
   - When you see `test-user-1`'s card, click **"✅ Proceed"**
   - Both users will now enter streaming!

3. **Result:**
   - Both users' status changes to `IN_SQUAD`
   - A streaming room is automatically created
   - The interface switches to the **Streaming** tab
   - Room details are pre-filled

#### Option B: Automated Testing (Single Tab)

1. Go to the **Discovery** tab
2. Scroll to **"🧪 Test Mutual Acceptance Flow"** section
3. Enter:
   - **User 1 ID**: `test-user-1`
   - **User 2 ID**: `test-user-2`
   - **Acceptance Timeout**: `30` seconds (default)
4. Click **"🎯 Test Mutual Acceptance"**
   - This automatically:
     - User1 gets User2's card (creates match)
     - User1 clicks Proceed (records acceptance)
     - User2 gets User1's card
     - User2 clicks Proceed (completes mutual acceptance)
   - If both accept within the timeout, a room is created
   - Both users' status changes to `IN_SQUAD`

### Step 4: Streaming Room

After mutual acceptance:
- Room is automatically created
- Interface switches to **Streaming** tab
- Room ID is pre-filled
- Both users are now `IN_SQUAD` status

**Manual Room Creation:**
- Go to **Streaming** tab
- Enter User IDs (comma-separated, 2-4 users)
- Select Call Type (matched/squad)
- Click **"Create Room"**

### Step 5: Send Gifts & Dares

1. **Send Gift:**
   - Enter Room ID
   - Enter From/To User IDs
   - Enter Amount (coins)
   - Optionally enter Gift ID (e.g., `monkey`, `pikachu`)
   - Click **"Send Gift"**

2. **Send Dare:**
   - Enter Room ID
   - Enter User ID (sender)
   - Enter Dare ID (e.g., `dare-1`)
   - Enter Gift ID (e.g., `monkey`)
   - Click **"Send Dare"**

### Step 6: View Wallet & Gift Transactions

1. Go to **Wallet** tab
2. **Get Balance**: Enter User ID, click "Get Balance"
3. **Get Gift Transactions**: Enter User ID, click "Get Gift Transactions"
   - Shows all transactions where user received gifts
   - Includes gift IDs (monkey, pikachu, etc.)

### Step 7: Cleanup & Reset

1. Go to **Setup** tab
2. Click **"🗑️ Cleanup & Reset All Sessions"**
   - Resets all discovery sessions
   - Clears rainchecked users
   - Allows you to see all cards again from the beginning

## API Gateway Endpoints

All interfaces use API Gateway endpoints with the `/v1` prefix and `/test/` for test endpoints:

### Discovery Service
- `GET /v1/discovery/test/card?userId=xxx&sessionId=xxx` - Get next card
- `POST /v1/discovery/test/raincheck` - Raincheck a user
- `POST /v1/discovery/test/proceed` - Proceed with match (mutual acceptance)
- `POST /v1/discovery/test/reset-session` - Reset discovery session
- `POST /v1/discovery/test/select-location` - Change preferred city

### Streaming Service
- `POST /v1/streaming/test/rooms` - Create room
- `GET /v1/streaming/test/rooms/:roomId` - Get room details
- `GET /v1/streaming/test/rooms/:roomId/chat` - Get chat history
- `POST /v1/streaming/rooms/:roomId/gifts` - Send gift (test mode enabled)
- `POST /v1/streaming/rooms/:roomId/dares/send` - Send dare (test mode enabled)

### Wallet Service
- `GET /v1/wallet/test/balance?userId=xxx` - Get balance
- `POST /v1/wallet/test/wallet/add-coins` - Add coins
- `GET /v1/wallet/test/wallet?userId=xxx&includeTransactions=true` - Get wallet
- `GET /v1/wallet/test/wallet/gift-transactions?userId=xxx` - Get gift transactions

### User Service
- `GET /v1/users/test/:userId` - Get user profile
- `POST /v1/users/:userId/profile` - Create user profile
- `PATCH /v1/users/test/:userId/profile` - Update profile
- `PATCH /v1/users/test/:userId/location` - Update location
- `PATCH /v1/users/test/:userId/preferred-city` - Update preferred city
- `PATCH /v1/users/test/:userId/status` - Update user status

### Friends Service
- `GET /v1/friends/test/friends?userId=xxx&limit=50` - Get friends list
- `GET /v1/friends/test/friends/requests/pending?userId=xxx` - Get pending requests
- `GET /v1/friends/test/friends/requests/sent?userId=xxx` - Get sent requests

## Prerequisites

### Quick Setup (Recommended)

**Run the prerequisites script first to ensure all databases are migrated:**

```bash
# From the project root directory
bash scripts/setup-prerequisites.sh
```

This script will:
- ✅ Check PostgreSQL and Redis are running
- ✅ Generate Prisma clients for all services
- ✅ Sync all database schemas
- ✅ Verify critical tables exist
- ✅ Handle failed migrations automatically

**Important:** Run this script before testing, especially if you:
- Cloned the repo fresh
- Pulled new migrations
- See database-related errors

### Manual Prerequisites

1. **API Gateway** must be running on port 3000 (default)
2. **Backend Services** must be running:
   - Discovery Service (port 3004)
   - User Service (port 3002)
   - Wallet Service (port 3005)
   - Streaming Service (port 3006) - **Must have `NODE_ENV=test` set**
   - Friend Service (port 3009)
3. **Database** must be set up and migrated (use `scripts/setup-prerequisites.sh`)
4. **Redis** (optional, for rate limiting)

### Starting Services

**Streaming Service** (requires TEST_MODE):
```bash
cd apps/streaming-service
NODE_ENV=test npm start
# Or use the updated package.json which includes NODE_ENV=test
npm start
```

**Other Services:**
```bash
# Discovery Service
cd apps/discovery-service
npm start

# User Service
cd apps/user-service
npm start

# Wallet Service
cd apps/wallet-service
npm start

# Friend Service
cd apps/friend-service
npm start
```

## Running the Interfaces

### Option 1: Direct File Access
Simply open the HTML file in your web browser:
```bash
open tests/html-interfaces/comprehensive-test-interface.html
# or
xdg-open tests/html-interfaces/comprehensive-test-interface.html  # Linux
```

### Option 2: Local HTTP Server
For better CORS handling, use a local HTTP server:
```bash
# Using Python
cd tests/html-interfaces
python3 -m http.server 8080

# Using Node.js (http-server)
npx http-server -p 8080

# Then open: http://localhost:8080/comprehensive-test-interface.html
```

## Configuration

### Changing API Gateway URL

In the HTML interface:
- Update the "API Gateway URL" input field in the Setup tab
- Or modify the `BASE_URL` constant in the JavaScript section (default: `http://localhost:3000`)

## Test Users

The comprehensive test data creation creates 22+ users:

**Mumbai (6 users):**
- `test-user-1` through `test-user-6`

**Delhi (5 users):**
- `test-user-7` through `test-user-11`

**Bangalore (4 users):**
- `test-user-12` through `test-user-15`

**Pune (3 users):**
- `test-user-16` through `test-user-18`

**Chennai (2 users):**
- `test-user-19`, `test-user-20`

**Hyderabad (2 users):**
- `test-user-21`, `test-user-22`

All test users have:
- Complete profiles with display pictures
- 10,000 coins in their wallets
- Location data (latitude/longitude)
- Preferred city set
- Status set to `AVAILABLE`

## User Status Flow

The system tracks user status throughout the flow:

1. **AVAILABLE** - User is available for matching (initial state)
2. **MATCHED** - User has matched with someone (both see each other's cards)
3. **IN_SQUAD** - Both users accepted, entered streaming room
4. **IN_BROADCAST** - User is broadcasting (if enabled)
5. **ONLINE/OFFLINE** - Connection status

**Status Display:**
- The Discovery tab shows the current user's status at the top
- Status badges are color-coded:
  - AVAILABLE: Green
  - MATCHED: Yellow
  - IN_SQUAD: Blue
  - IN_BROADCAST: Red
  - ONLINE: Cyan
  - OFFLINE: Gray

## Mutual Acceptance Flow Details

### How It Works

1. **Match Creation:**
   - When User1 gets User2's card, a match is created in `active_matches` table
   - Both users' status changes to `MATCHED`

2. **First Acceptance:**
   - When User1 clicks "Proceed", their acceptance is recorded in `match_acceptances` table
   - User1 sees: "Waiting for User2 to accept..."
   - A timeout starts (default: 30 seconds)

3. **Second Acceptance:**
   - When User2 clicks "Proceed" (within timeout), their acceptance is recorded
   - System checks: Both users have accepted
   - Actions taken:
     - Match record is removed from `active_matches`
     - Acceptance records are removed
     - Both users' status changes to `IN_SQUAD`
     - Streaming room is automatically created
     - Room ID and session ID are returned

4. **Timeout:**
   - If User2 doesn't accept within the timeout:
     - Acceptance records expire
     - Both users' status reverts to `AVAILABLE`
     - They can see new cards again

### Testing Mutual Acceptance

**Method 1: Two Browser Tabs**
- Open HTML interface in two tabs
- Tab 1: Use `test-user-1`, get card, click Proceed
- Tab 2: Use `test-user-2`, get card, click Proceed
- Both should enter streaming

**Method 2: Automated Test**
- Use "Test Mutual Acceptance" button in Discovery tab
- Enter both user IDs
- Click "Test Mutual Acceptance"
- System automatically simulates both users accepting

**Method 3: Check Status**
- Use "Check Acceptance Status" button
- Shows current status of both users
- Indicates if they're ready for mutual acceptance

## Notes for Frontend Team

1. **Always use API Gateway endpoints** - Never call backend services directly
2. **Use `/v1` prefix** - All API Gateway routes are under `/v1`
3. **Test endpoints** - Use `/test/` prefix for test endpoints (bypasses authentication)
4. **Mutual Acceptance** - Both users must accept before entering streaming
5. **Status Management** - Track user status throughout the flow
6. **Error handling** - Check response status codes and handle errors appropriately
7. **Match Explanation** - Display why users matched (score, reasons) for better UX

## Troubleshooting

### Service Not Running
- Check that API Gateway is running: `curl http://localhost:3000/health`
- Verify backend services are running on their respective ports
- **Streaming Service**: Must have `NODE_ENV=test` set (check `.env` file)

### CORS Errors
- Use a local HTTP server instead of opening the file directly
- Ensure API Gateway CORS is configured correctly

### 404 Errors
- Verify the API Gateway route configuration
- Check that the service path is correct (e.g., `/v1/discovery/test/card`)
- Ensure test endpoints exist (they should have `/test/` in path)

### 503 Errors
- Backend service may be down
- Check service logs for errors
- Verify database connections
- For streaming service: Ensure `NODE_ENV=test` is set

### No Cards Showing
- Ensure test users are created (Setup tab)
- Check that users have `AVAILABLE` status
- Verify users have location data (latitude/longitude)
- Check that users have preferred city set
- Try "Reset Session" or "Cleanup & Reset All Sessions"

### Match Creation Fails
- Ensure `active_matches` table exists in database
- Check discovery-service logs for database errors
- Verify both users exist and have `AVAILABLE` status
- Try creating users again from Setup tab

### Mutual Acceptance Not Working
- Ensure both users have `MATCHED` status (get cards first)
- Check that timeout hasn't expired (default: 30 seconds)
- Verify `match_acceptances` table exists in database
- Check discovery-service logs for errors

## Contributing

When adding new test interfaces:

1. Place HTML files in this directory
2. Use API Gateway endpoints with `/v1` prefix
3. Use `/test/` prefix for test endpoints (bypasses authentication)
4. Include setup scripts if needed
5. Update this README with usage instructions
6. Follow the existing interface design patterns
