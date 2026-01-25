# Health Check Troubleshooting Guide

## Issue: Service shows as healthy in setup script but curl fails

### Symptoms
- Setup script reports: `✓ streaming-service is running and healthy on port 3006`
- Manual curl fails: `Error: connect ECONNREFUSED 127.0.0.1:3006`

### Diagnostic Commands

```bash
# 1. Check if port 3006 is actually listening
lsof -i :3006

# 2. Check what process is using port 3006
netstat -an | grep 3006
# or on macOS:
lsof -nP -iTCP:3006 | grep LISTEN

# 3. Check if streaming-service process is running
ps aux | grep streaming-service | grep -v grep

# 4. Check service logs for errors
tail -50 /tmp/streaming-service.log

# 5. Try different connection methods
curl http://localhost:3006/health
curl http://127.0.0.1:3006/health
curl http://0.0.0.0:3006/health  # This won't work, but shows if binding is the issue

# 6. Check if service is binding to the right interface
# Services should bind to 0.0.0.0 to accept connections from localhost
```

### Common Causes

1. **Service died after health check**
   - Service passed initial check but crashed afterward
   - Check logs: `tail -f /tmp/streaming-service.log`

2. **Port conflict**
   - Another process is using port 3006
   - Check: `lsof -i :3006`

3. **Service not fully started**
   - Health check passed but service is still initializing
   - Wait a few seconds and try again

4. **Binding issue**
   - Service might be binding to wrong interface
   - Should bind to `0.0.0.0` (all interfaces)
   - Check: `lsof -i :3006` should show `*:3006` or `0.0.0.0:3006`

5. **Firewall or network issue**
   - Local firewall blocking connections
   - Check: `sudo lsof -i :3006`

### Quick Fix Commands

```bash
# Kill any process on port 3006
lsof -ti :3006 | xargs kill -9 2>/dev/null

# Restart streaming-service manually
cd apps/streaming-service
npm run start:dev

# Or restart via setup script
./scripts/setup-and-start-services.sh
```

### Verify Service is Actually Running

```bash
# Check if service is listening on port 3006
lsof -i :3006 | grep LISTEN

# Expected output should show:
# node  <PID>  <user>  <fd>  IPv4  <address>  TCP *:3006 (LISTEN)
# or
# node  <PID>  <user>  <fd>  IPv4  <address>  TCP 0.0.0.0:3006 (LISTEN)

# If you see nothing, the service is not listening
```

### Test Connection

```bash
# Test with verbose curl to see what's happening
curl -v http://localhost:3006/health

# Test with timeout
curl --max-time 5 http://localhost:3006/health

# Test with different hostname
curl http://127.0.0.1:3006/health
```
