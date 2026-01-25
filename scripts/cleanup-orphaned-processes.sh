#!/bin/bash

# Cleanup script for orphaned npm/node processes
# Run this if you have too many processes or services are unstable

echo "🧹 Cleaning up orphaned processes..."

# Kill all npm processes that are orphaned (no corresponding node process)
echo "Checking for orphaned npm processes..."
npm_pids=$(ps aux | grep "npm run start:dev" | grep -v grep | awk '{print $2}')

orphaned_count=0
for npm_pid in $npm_pids; do
    # Check if there's a corresponding node process
    # npm spawns node, so if npm exists but node doesn't, it's orphaned
    has_node_child=false
    
    # Check child processes
    child_pids=$(pgrep -P $npm_pid 2>/dev/null || echo "")
    for child_pid in $child_pids; do
        if ps -p $child_pid -o command= 2>/dev/null | grep -q "node.*dist/main"; then
            has_node_child=true
            break
        fi
    done
    
    if [ "$has_node_child" = false ]; then
        echo "  Killing orphaned npm process: $npm_pid"
        kill -9 $npm_pid 2>/dev/null || true
        orphaned_count=$((orphaned_count + 1))
    fi
done

echo "✅ Killed $orphaned_count orphaned npm processes"

# Kill all processes on service ports that aren't actually services
echo ""
echo "Cleaning up ports..."
for port in 3000 3001 3002 3003 3004 3005 3006 3007 3008 3009; do
    pids=$(lsof -ti:$port 2>/dev/null || echo "")
    if [ -n "$pids" ]; then
        for pid in $pids; do
            cmd=$(ps -p $pid -o command= 2>/dev/null || echo "")
            if ! echo "$cmd" | grep -qE "node.*dist/main|npm.*start:dev"; then
                echo "  Killing non-service process on port $port: $pid"
                kill -9 $pid 2>/dev/null || true
            fi
        done
    fi
done

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "Current service status:"
ps aux | grep "node.*dist/main" | grep -v grep | wc -l | xargs echo "Active node services:"
ps aux | grep "npm run start:dev" | grep -v grep | wc -l | xargs echo "Active npm processes:"
