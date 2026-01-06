#!/bin/bash

# Simple script to start a local web server for the interactive test tool
# This avoids CORS issues when opening HTML files directly

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PORT=8000

echo "🚀 Starting local web server on port $PORT..."
echo "📁 Serving from: $ROOT_DIR"
echo ""
echo "✅ Once started, open in your browser:"
echo "   http://localhost:$PORT/tests/streaming-service/interactive-test.html"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

cd "$ROOT_DIR"
python3 -m http.server $PORT 2>/dev/null || python -m http.server $PORT 2>/dev/null || {
    echo "❌ Python not found. Please install Python 3 or use:"
    echo "   python3 -m http.server $PORT"
    exit 1
}

