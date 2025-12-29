#!/bin/bash

echo "🚀 Quick Start for Testing User Service & Moderation Service"
echo ""

# Check if services are ready
echo "Checking services..."
cd apps/user-service && npm list @nestjs/core > /dev/null 2>&1 && echo "✅ User service dependencies installed" || echo "❌ User service: Run 'npm install'"
cd ../moderation-service && npm list @nestjs/core > /dev/null 2>&1 && echo "✅ Moderation service dependencies installed" || echo "❌ Moderation service: Run 'npm install'"

echo ""
echo "To start services, open 3 terminals and run:"
echo ""
echo "Terminal 1 (Moderation Service):"
echo "  cd apps/moderation-service && npm run start:dev"
echo ""
echo "Terminal 2 (User Service):"
echo "  cd apps/user-service && npm run start:dev"
echo ""
echo "Terminal 3 (Auth Service - if needed):"
echo "  cd apps/auth-service && npm run start:dev"
echo ""
echo "See TESTING_CHECKLIST.md for detailed testing guide"
