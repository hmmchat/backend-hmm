#!/bin/bash

# Quick Setup Script - Run prerequisites and start services check
# This is a convenience wrapper around setup-prerequisites.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "🚀 HMM Backend Quick Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run prerequisites
echo "📦 Step 1: Setting up prerequisites..."
bash "$ROOT_DIR/scripts/setup-prerequisites.sh"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Prerequisites setup complete!"
    echo ""
    echo "📝 Next steps:"
    echo "   1. Start your services (see README.md)"
    echo "   2. Run: open tests/html-interfaces/comprehensive-test-interface.html"
    echo ""
else
    echo ""
    echo "❌ Prerequisites setup had issues. Please fix them before continuing."
    exit 1
fi
