# Quick Access Guide

## File Locations

The interactive test tool is located at:
```
backend-hmm/tests/streaming-service/interactive-test.html
```

**NOT** in `apps/streaming-service/` - it's at the **root level** in `tests/streaming-service/`

## Quick Ways to Open

### Option 1: From Root Directory
```bash
cd /Users/arya.prakash/backend-hmm
open tests/streaming-service/interactive-test.html
```

### Option 2: Use the Quick Start Script
```bash
cd /Users/arya.prakash/backend-hmm
./tests/streaming-service/start-interactive-test.sh
```

### Option 3: Direct Path (macOS)
```bash
open /Users/arya.prakash/backend-hmm/tests/streaming-service/interactive-test.html
```

### Option 4: Linux
```bash
xdg-open /Users/arya.prakash/backend-hmm/tests/streaming-service/interactive-test.html
```

## Current Directory Check

If you're in `apps/streaming-service/`, go back to root:
```bash
cd ../..
# Now you're in backend-hmm/
open tests/streaming-service/interactive-test.html
```

## Complete Setup Flow

1. **Start the service** (in `apps/streaming-service/`):
   ```bash
   cd apps/streaming-service
   TEST_MODE=true npm run start:dev
   ```

2. **Open test tool** (from root):
   ```bash
   cd ../..
   open tests/streaming-service/interactive-test.html
   ```

Or use the quick start script which does both!

