# Production Critical Fixes - Payment Service

This document outlines the critical fixes implemented to make the payment service production-ready.

## ✅ Critical Issues Fixed

### 1. Environment Variable Validation ✅
**Issue:** Configuration errors only discovered at runtime when services are called.

**Fix:** Added `EnvValidationService` that validates all required environment variables at application startup.

**Location:** `src/config/env.validation.ts`

**Required Environment Variables:**
- `RAZORPAY_KEY_ID` - Razorpay API key
- `RAZORPAY_KEY_SECRET` - Razorpay API secret
- `RAZORPAY_WEBHOOK_SECRET` - Razorpay webhook signature secret
- `PAYMENT_ENCRYPTION_KEY` - Encryption key for sensitive data (min 32 chars, recommended: 64 hex)
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_PUBLIC_JWK` - JWT public key for authentication
- `WALLET_SERVICE_URL` - Wallet service URL (optional, defaults to localhost:3006)

### 2. Sensitive Data Encryption ✅
**Issue:** Bank account details stored in plaintext.

**Fix:** Implemented `EncryptionService` using AES-256-GCM encryption for bank account numbers.

**Location:** `src/services/encryption.service.ts`

**Features:**
- AES-256-GCM encryption with random IV
- Authentication tag for integrity verification
- Key derivation using PBKDF2 (if key not in hex format)
- Automatic encryption/decryption in payment service

**Usage:**
```typescript
// Automatically encrypts bank account number before storing
const encrypted = encryptionService.encrypt(accountNumber);
const decrypted = encryptionService.decrypt(encrypted);
```

### 3. Race Conditions & Data Integrity ✅
**Issue:** Concurrent requests could process the same payment/redemption multiple times.

**Fix:** Implemented database transactions with row-level locking (`SELECT FOR UPDATE`).

**Location:** `src/services/payment.service.ts`

**Key Changes:**
- `handlePaymentSuccess`: Uses transaction with `SELECT FOR UPDATE` to lock order row
- Payment ID duplicate check before processing
- Serializable isolation level for maximum consistency
- 30-second transaction timeout

**Benefits:**
- Prevents double-crediting of coins
- Prevents duplicate payment processing
- Ensures order status updates are atomic

### 4. Transaction Atomicity ✅
**Issue:** Order creation and wallet operations not atomic, could leave system in inconsistent state.

**Fix:** Wrapped critical operations in database transactions.

**Location:** `src/services/payment.service.ts`

**Transactions Added:**
1. **Payment Processing:**
   - Order lookup with lock → Payment verification → Wallet credit → Order update (all in one transaction)

2. **Redemption Processing:**
   - Balance check with lock → Redemption request creation → Coin deduction (within transaction)
   - Payout creation → Status update (with rollback on failure)

**Transaction Settings:**
- Isolation Level: `Serializable` (highest consistency)
- Timeout: 30 seconds
- Automatic rollback on errors

### 5. Webhook Idempotency ✅
**Issue:** Same webhook could be processed multiple times if Razorpay retries.

**Fix:** Multiple layers of idempotency checks.

**Location:** `src/routes/payment.controller.ts`

**Idempotency Checks:**
1. **Before Processing:** Check if payment/payout ID already processed
2. **During Processing:** Update webhook status to `PROCESSING` immediately
3. **Payment Events:** Verify `razorpayPaymentId` not already in `COMPLETED` orders
4. **Payout Events:** Verify payout ID status before updating redemption request
5. **Transaction-based Updates:** Use transactions for payout status updates

**Benefits:**
- Prevents duplicate coin credits
- Prevents duplicate payout processing
- Handles Razorpay webhook retries gracefully

### 6. Health Check Endpoint ✅
**Issue:** No way to monitor service health.

**Fix:** Added `/health` endpoint.

**Location:** `src/routes/payment.controller.ts`

**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "healthy",
  "service": "payment-service",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "database": "connected"
}
```

**Status Codes:**
- `200 OK` - Service healthy
- `503 Service Unavailable` - Database disconnected or other issues

## 🔒 Security Improvements

1. **Encryption:** All bank account numbers encrypted at rest
2. **Signature Verification:** All webhooks verified before processing
3. **Transaction Isolation:** Serializable isolation prevents read anomalies
4. **Idempotency:** Multiple checks prevent duplicate processing

## 📊 Database Schema Updates

No schema changes required - all fixes work with existing schema.

**Important:** Ensure proper indexes exist on:
- `payment_orders.razorpay_payment_id` (for idempotency checks)
- `redemption_requests.razorpay_payout_id` (for idempotency checks)
- `payment_webhooks.event_type` and `status` (for webhook lookup)

## 🚀 Deployment Checklist

Before deploying to production:

- [ ] Set `PAYMENT_ENCRYPTION_KEY` environment variable (64 hex characters recommended)
- [ ] Set all Razorpay credentials (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`)
- [ ] Configure `RAZORPAY_ACCOUNT_NUMBER` for payouts
- [ ] Set `WALLET_SERVICE_URL` to production wallet service
- [ ] Configure database connection pool settings
- [ ] Set up monitoring for `/health` endpoint
- [ ] Configure webhook URL in Razorpay dashboard: `https://your-domain.com/v1/payments/webhooks/razorpay`
- [ ] Test webhook signature verification
- [ ] Run Prisma migrations: `npm run prisma:deploy`

## ⚠️ Important Notes

1. **Encryption Key:** Once set, do NOT change `PAYMENT_ENCRYPTION_KEY` without migrating existing encrypted data.

2. **Transaction Timeout:** 30-second timeout may need adjustment based on wallet-service response times.

3. **Webhook Retries:** Razorpay retries failed webhooks. Idempotency checks handle this, but monitor webhook logs for patterns.

4. **Database Performance:** Serializable isolation level is safest but may impact performance under high concurrency. Monitor and adjust if needed.

## 🧪 Testing Recommendations

1. **Race Condition Testing:** Send multiple concurrent requests for same order
2. **Webhook Idempotency:** Send same webhook multiple times
3. **Encryption:** Verify bank account numbers are encrypted in database
4. **Transaction Rollback:** Simulate wallet-service failures during payment processing
5. **Health Check:** Monitor `/health` endpoint in production

## 📝 Migration Notes

For existing data (if any):
- Existing bank account numbers in plaintext need to be encrypted
- Run migration script to encrypt existing `bankAccountNumber` fields
- Verify encryption/decryption works correctly before deployment

---

**Status:** All critical issues resolved ✅
**Production Ready:** Yes, after completing deployment checklist above
