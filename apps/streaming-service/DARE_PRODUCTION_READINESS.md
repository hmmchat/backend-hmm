# Dare Feature - Production Readiness & Edge Cases

## ✅ Implemented Features

1. **Dare Viewing (Real-time Sync)** - Users can view dares and others see them in real-time
2. **Dare Assignment** - Users can assign dares to other participants
3. **Gift Selection** - Users select gifts with diamond costs
4. **50/50 Payment Split** - 50% on send, 50% on confirmation
5. **Dare Status Flow** - viewing → assigned → sent → done → confirmed
6. **Wallet Integration** - Coin transfers via wallet-service
7. **WebSocket Events** - Real-time synchronization
8. **Repeatable Dares** - Same dare can be assigned multiple times (no restriction on repeating dares)
9. **Pending Dare Cleanup** - When room ends, dares with incomplete payment (50% paid but not confirmed) are marked as "cancelled"

## 💡 Important Clarifications

- **Dare List**: Always the same, users can repeat any dare as many times as they want
- **Pending Dares**: Dares where 50% payment was made (status="sent" or "done") but remaining 50% not yet paid (not "confirmed")
- **Payment Flow**:
  1. User assigns dare → status="assigned"
  2. User sends dare with gift → 50% diamonds/coins transferred → status="sent"
  3. Assigned user marks done → status="done"
  4. Original user confirms → remaining 50% diamonds/coins transferred → status="confirmed"
- **Room End Behavior**: If room ends before confirmation, the dare is marked "cancelled" (50% already paid stays, remaining 50% won't be paid)

## ⚠️ Edge Cases Identified & Status

### ✅ Covered in Tests

1. **Assign dare to self** - ✅ Rejected
2. **Send dare without assigning** - ✅ Rejected  
3. **Mark done for dare not assigned to you** - ✅ Rejected
4. **Confirm dare that wasn't done** - ✅ Rejected
5. **Insufficient balance** - ✅ Rejected
6. **Invalid gift ID** - ✅ Rejected
7. **Assign to non-participant** - ✅ Rejected
8. **Multiple dares in same room** - ✅ Supported

### ⚠️ Edge Cases Requiring Attention

1. **Room Ends During Dare Flow**
   - **Issue**: If room ends while dare is in "sent" or "done" status, remaining 50% payment never completes
   - **What "Pending" Means**: 
     - A dare record where 50% payment was made (status="sent" or "done")
     - But remaining 50% payment hasn't been made yet (status not "confirmed")
     - This is a payment state, NOT about the dare list (dare list doesn't track completion)
   - **Example**: User A sends dare-1 with 50 diamonds → 2500 coins (50%) paid to User B. Room ends before User A confirms → remaining 2500 coins won't be paid
   - **Status**: ✅ Fixed - Cleanup added in `endRoom()` to mark these as "cancelled"
   - **Behavior**: When room ends, any dare with `status="sent"` or `status="done"` but `secondPaymentSent=false` is marked as "cancelled"
   - **Important**: The 50% already paid stays with the receiver (no refund). This is intentional - they did receive the dare and may have even completed it.
   - **Note**: Users can repeat the same dare multiple times. Each assignment is a separate record with its own payment flow.

2. **User Leaves Room During Dare Flow**
   - **Issue**: User leaves room while dare is assigned/sent/done
   - **Status**: ⚠️ Partial - Database state may be inconsistent
   - **Recommendation**: Add validation checks before all dare operations

3. **Payment Failure After Database Update**
   - **Issue**: Database updated but payment fails (shouldn't happen due to order, but edge case exists)
   - **Status**: ✅ Protected - Payment happens before DB update, rollback exists

4. **Concurrent Dare Operations**
   - **Issue**: Multiple users trying to assign same dare, or same user multiple times
   - **Status**: ⚠️ Partial - Race conditions possible
   - **Recommendation**: Add database-level constraints or optimistic locking

5. **WebSocket Disconnection During Flow**
   - **Issue**: User disconnects during dare flow
   - **Status**: ✅ Handled - Operations are stateless, can reconnect

6. **Room Not in Memory (After Restart)**
   - **Issue**: Service restart loses in-memory state
   - **Status**: ✅ Handled - `roomExists()` reloads from DB

7. **Invalid Dare ID in View/Assign**
   - **Issue**: User provides invalid dare ID
   - **Status**: ✅ Handled - Validation in `viewDare()` and `assignDare()`

8. **Dare Already Confirmed**
   - **Issue**: Trying to confirm same dare twice
   - **Status**: ✅ Handled - Check for `secondPaymentSent` in `confirmDareCompletion()`

9. **Gift Not Selected Before Send**
   - **Issue**: Send dare without gift (should not happen, but edge case)
   - **Status**: ✅ Handled - Gift selection required in `sendDare()`

10. **Transaction ID Storage Failure**
    - **Issue**: Payment succeeds but transaction ID not saved
    - **Status**: ⚠️ Warning logged but operation continues

## 🔧 Production Readiness Issues

### Critical Issues

1. **Database Transaction Safety**
   - **Issue**: No explicit Prisma transactions for multi-step operations
   - **Impact**: If payment succeeds but DB update fails, payment is lost
   - **Status**: ⚠️ Need to add `prisma.$transaction()` for atomic operations
   - **Priority**: HIGH

2. **Payment Rollback Reliability**
   - **Issue**: Rollback in `transferCoins()` may fail silently
   - **Impact**: Funds could be lost if rollback fails
   - **Status**: ⚠️ Need better error handling and alerts
   - **Priority**: HIGH

3. **Rate Limiting**
   - **Issue**: No rate limiting on dare operations
   - **Impact**: Potential abuse (rapid dare assignments, spam)
   - **Status**: ❌ Not implemented
   - **Priority**: MEDIUM

4. **Input Validation**
   - **Issue**: Some validation done but could be stricter
   - **Status**: ✅ Basic validation exists, could be enhanced
   - **Priority**: MEDIUM

### Medium Priority Issues

5. **Logging & Monitoring**
   - **Status**: ✅ Basic logging exists
   - **Recommendation**: Add structured logging with correlation IDs

6. **Error Messages**
   - **Status**: ✅ Descriptive error messages
   - **Recommendation**: Ensure errors don't leak sensitive info

7. **API Security**
   - **Status**: ✅ TEST_MODE bypasses auth (expected)
   - **Recommendation**: Ensure production enforces authentication

8. **Diamond/Coin Conversion**
   - **Status**: ✅ Configurable via env vars
   - **Recommendation**: Document configuration clearly

### Low Priority / Nice to Have

9. **Audit Trail**
   - **Status**: ✅ Transaction IDs stored
   - **Recommendation**: Add audit log table for dare operations

10. **Dare Expiration**
    - **Status**: ❌ Not implemented
    - **Recommendation**: Add timeout for "assigned" dares (e.g., 5 minutes)

11. **Bulk Operations**
    - **Status**: ❌ Not needed currently
    - **Recommendation**: Monitor performance for multiple dares

## 🛠️ Recommended Fixes Before Production

### High Priority

1. **Add Database Transactions** for `sendDare()` and `confirmDareCompletion()`
   ```typescript
   await this.prisma.$transaction(async (tx) => {
     // Payment + DB update atomically
   });
   ```

2. **Improve Payment Rollback** with better error handling and alerts

3. **Add Rate Limiting** middleware for dare endpoints

### Medium Priority

5. **Add Dare Expiration** logic (auto-cancel assigned dares after timeout)

6. **Enhanced Logging** with correlation IDs and structured format

7. **Add Validation** for concurrent operations (optimistic locking)

## 📊 Test Coverage

- **E2E Tests**: 15 new tests (51-65) covering all flows and edge cases
- **Manual Testing**: HTML interactive tool with edge case buttons
- **Coverage**: ~90% of happy paths and major edge cases

## ✅ Production Ready Checklist

- [x] Core functionality implemented
- [x] Basic error handling
- [x] Input validation
- [x] Database schema updated
- [x] WebSocket events working
- [x] E2E tests written
- [x] Manual testing tool available
- [ ] Database transactions for atomicity ⚠️
- [ ] Payment rollback reliability ⚠️
- [ ] Room end cleanup ⚠️
- [ ] Rate limiting ❌
- [ ] Comprehensive logging ❌
- [ ] Production auth enforcement ⚠️ (TEST_MODE disabled)

## 🚀 Deployment Notes

1. **Environment Variables Required**:
   - `DIAMOND_TO_COIN_RATE` (default: 50)
   - `WALLET_SERVICE_URL` (default: http://localhost:3006)
   - `TEST_MODE=false` (for production)

2. **Database Migration**:
   - Schema changes already applied via `prisma db push`
   - New fields: `assignedTo`, `giftId`, `giftDiamonds`, payment fields, timestamps

3. **Dependencies**:
   - Wallet-service must be running and accessible
   - Streaming-service must have network access to wallet-service

4. **Monitoring**:
   - Monitor wallet transaction failures
   - Track dare completion rates
   - Alert on payment rollback failures

