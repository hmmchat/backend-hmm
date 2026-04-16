#!/usr/bin/env bash
set -euo pipefail

# Smoke-test script for Beam internal KYC backend APIs.
# Requires user-service, discovery-service, moderation-service, wallet-service running locally.
#
# Usage:
#   USER_ID=u123 MODERATOR_ID=mod123 ./scripts/test-kyc-backend-smoke.sh

USER_SERVICE_URL="${USER_SERVICE_URL:-http://localhost:3002}"
MODERATION_SERVICE_URL="${MODERATION_SERVICE_URL:-http://localhost:3003}"

USER_ID="${USER_ID:-}"
MODERATOR_ID="${MODERATOR_ID:-}"

if [[ -z "${USER_ID}" || -z "${MODERATOR_ID}" ]]; then
  echo "USER_ID and MODERATOR_ID are required"
  echo "Example: USER_ID=u123 MODERATOR_ID=mod123 $0"
  exit 1
fi

echo "1) Set moderator flag and KYC status on user-service admin endpoint"
curl -sS -X POST "${USER_SERVICE_URL}/admin/users/${MODERATOR_ID}/kyc" \
  -H "Content-Type: application/json" \
  -d '{
    "isModerator": true,
    "kycStatus": "UNVERIFIED",
    "moderationMeta": { "updatedBy": "smoke-test", "reason": "prepare moderator" }
  }' >/dev/null

echo "2) Start KYC session"
START_RESPONSE="$(curl -sS -X POST "${MODERATION_SERVICE_URL}/v1/kyc/session/start" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"${USER_ID}\",
    \"moderatorId\": \"${MODERATOR_ID}\"
  }")"
echo "${START_RESPONSE}"
SESSION_ID="$(echo "${START_RESPONSE}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(j.sessionId||"")}catch{}})')"
if [[ -z "${SESSION_ID}" ]]; then
  echo "Failed to get sessionId from start response"
  exit 1
fi

echo "3) Submit VERIFIED decision"
curl -sS -X POST "${MODERATION_SERVICE_URL}/v1/kyc/session/decision" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\": \"${SESSION_ID}\",
    \"moderatorId\": \"${MODERATOR_ID}\",
    \"decision\": \"VERIFIED\",
    \"reason\": \"smoke test verify\"
  }"
echo

echo "4) Submit feedback (reward path if enabled)"
curl -sS -X POST "${MODERATION_SERVICE_URL}/v1/kyc/feedback" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"${USER_ID}\",
    \"sessionId\": \"${SESSION_ID}\",
    \"questionOne\": \"Was this call clear?\",
    \"questionTwo\": \"Any trust feedback?\"
  }"
echo

echo "5) Revoke KYC via admin endpoint"
curl -sS -X POST "${MODERATION_SERVICE_URL}/v1/admin/users/${USER_ID}/kyc/revoke" \
  -H "Content-Type: application/json" \
  -d "{
    \"moderatorId\": \"${MODERATOR_ID}\",
    \"reason\": \"smoke test revoke\"
  }"
echo

echo "KYC smoke tests completed."
