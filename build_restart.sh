#!/bin/bash
# Build frontend and restart backend
set -e
cd /home/agentuser/navsite/frontend
npx vite build 2>&1 | tail -6
echo "=== build done, restarting backend ==="
ps aux | grep "[t]sx src/main" | awk '{print $2}' | xargs -r kill -9
sleep 1
cd /home/agentuser/navsite/backend
nohup npx tsx src/main.ts > /tmp/navsite.log 2>&1 &
sleep 3
curl -s -o /dev/null -w "backend: HTTP %{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "admin page: HTTP %{http_code}\n" http://localhost:3000/admin/
curl -s -o /dev/null -w "spa fallback: HTTP %{http_code}\n" http://localhost:3000/some/route
