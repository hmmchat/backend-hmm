#!/bin/bash
# Check health of all backend services using correct endpoints per service.
# Payment-service uses /v1/payments/health, others use /health or /ready.

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}Checking all backend services...${NC}\n"

# Service name, port, health path (payment has different path)
declare -a SERVICES=(
  "api-gateway:3000:/health/live"
  "auth-service:3001:/health"
  "user-service:3002:/health"
  "moderation-service:3003:/health"
  "discovery-service:3004:/health"
  "wallet-service:3005:/health"
  "streaming-service:3006:/health"
  "payment-service:3007:/v1/payments/health"
  "files-service:3008:/health"
  "friend-service:3009:/health"
  "ads-service:3010:/health"
)

failed=()
for entry in "${SERVICES[@]}"; do
  IFS=':' read -r name port path <<< "$entry"
  code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://127.0.0.1:${port}${path}" 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    echo -e "  ${GREEN}✓${NC} $name (port $port)"
  else
    echo -e "  ${RED}✗${NC} $name (port $port) - HTTP $code"
    failed+=("$name")
  fi
done

echo ""
if [ ${#failed[@]} -eq 0 ]; then
  echo -e "${GREEN}All services are healthy.${NC}"
  exit 0
else
  echo -e "${YELLOW}Failed services: ${failed[*]}${NC}"
  echo -e "\n${CYAN}Check logs for failed services:${NC}"
  for name in "${failed[@]}"; do
    echo -e "  tail -50 /tmp/${name}.log"
  done
  echo -e "\n${CYAN}Common causes:${NC}"
  echo -e "  - Services still starting (wait 1-2 min after npm run dev)"
  echo -e "  - Redis not running (required for friend-service): brew services start redis"
  echo -e "  - Mediasoup port range blocked (streaming-service): check ports 40000-49999"
  echo -e "  - Database connection failed: verify Postgres and run create-databases-local.sh"
  exit 1
fi
