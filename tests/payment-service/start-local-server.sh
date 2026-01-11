#!/bin/bash

# Script to start payment-service locally for testing
# Sets test mode to allow running without payment gateway keys

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVICE_DIR="$ROOT_DIR/apps/payment-service"

echo "🚀 Starting Payment Service in TEST MODE..."
echo ""

cd "$SERVICE_DIR"

# Set test mode environment variable
export ALLOW_TEST_MODE=true
export NODE_ENV=development

# Set minimal required env vars for test mode
export PORT=${PORT:-3008}
export DATABASE_URL=${DATABASE_URL:-"postgresql://user:password@localhost:5432/hmm_payment?schema=public"}
export WALLET_SERVICE_URL=${WALLET_SERVICE_URL:-"http://localhost:3006"}

# Optional - set dummy values if not provided (only for test mode)
if [ -z "$RAZORPAY_KEY_ID" ]; then
    export RAZORPAY_KEY_ID="test_key_id"
fi
if [ -z "$RAZORPAY_KEY_SECRET" ]; then
    export RAZORPAY_KEY_SECRET="test_key_secret"
fi
if [ -z "$RAZORPAY_WEBHOOK_SECRET" ]; then
    export RAZORPAY_WEBHOOK_SECRET="test_webhook_secret"
fi
if [ -z "$JWT_PUBLIC_JWK" ]; then
    export JWT_PUBLIC_JWK='{"kty":"EC","crv":"P-256","x":"test","y":"test"}'
fi
if [ -z "$PAYMENT_ENCRYPTION_KEY" ]; then
    export PAYMENT_ENCRYPTION_KEY="test-encryption-key-32-chars-long-for-testing-only-do-not-use-in-production"
fi

echo "📝 Test Mode Configuration:"
echo "  - ALLOW_TEST_MODE=true"
echo "  - PORT=$PORT"
echo "  - DATABASE_URL=$DATABASE_URL"
echo "  - Using dummy/test credentials for Razorpay"
echo ""

# Start the service
npm run start:dev
