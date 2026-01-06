#!/bin/bash

# Quick start script for interactive streaming service testing

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
STREAMING_SERVICE_DIR="$ROOT_DIR/apps/streaming-service"
HTML_FILE="$SCRIPT_DIR/interactive-test.html"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}=========================================="
echo -e "  Streaming Service Interactive Test"
echo -e "==========================================${NC}"
echo ""

# Check if service is running
echo -e "${CYAN}Checking if streaming-service is running...${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3005/streaming/rooms/test" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "404" ] && [ "$HTTP_CODE" != "000" ]; then
    echo -e "${GREEN}✅ Streaming service appears to be running${NC}"
else
    echo -e "${YELLOW}⚠️  Streaming service may not be running${NC}"
    echo -e "${CYAN}Starting streaming-service in TEST_MODE...${NC}"
    echo ""
    echo -e "${YELLOW}Please run this in a separate terminal:${NC}"
    echo -e "${CYAN}cd $STREAMING_SERVICE_DIR${NC}"
    echo -e "${CYAN}TEST_MODE=true npm run start:dev${NC}"
    echo ""
    read -p "Press Enter once the service is running..."
fi

# Open the HTML file
echo -e "${CYAN}Opening interactive test tool in browser...${NC}"

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    open "$HTML_FILE"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    xdg-open "$HTML_FILE" 2>/dev/null || sensible-browser "$HTML_FILE" 2>/dev/null || echo "Please open $HTML_FILE in your browser"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    # Windows
    start "$HTML_FILE"
else
    echo "Please open $HTML_FILE in your browser"
fi

echo ""
echo -e "${GREEN}✅ Test tool opened!${NC}"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo -e "1. Test the connection (click 'Test Connection' button)"
echo -e "2. Follow the test cases in the tool"
echo -e "3. See INTERACTIVE_TEST_GUIDE.md for detailed instructions"
echo ""
echo -e "${CYAN}Happy Testing! 🚀${NC}"

