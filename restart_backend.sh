#!/bin/bash
# restart backend only
cd /home/agentuser/navsite/backend
ps aux | grep "[t]sx src/main" | awk '{print $2}' | xargs -r kill -9
sleep 1
nohup npx tsx src/main.ts > /tmp/navsite.log 2>&1 &
disown
sleep 3
curl -s -o /dev/null -w "root: %{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "admin: %{http_code}\n" http://localhost:3000/admin/
curl -s -o /dev/null -w "spa fallback: %{http_code}\n" http://localhost:3000/xx/yy
