#!/bin/sh
# Bakes OpenCode's first-start downloads (plugin into the config dir, models.json into the cache) into the image.
set -eu
# A throwaway password for this build-time server only.
OPENCODE_SERVER_PASSWORD=$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')
export HOME=/opt/oc/home XDG_CONFIG_HOME=/opt/oc/config XDG_CACHE_HOME=/opt/oc/cache XDG_DATA_HOME=/tmp/wd XDG_STATE_HOME=/tmp/ws OPENCODE_SERVER_PASSWORD
mkdir -p /tmp/p && cd /tmp/p && echo '{}' > opencode.json
opencode serve --port 4096 --hostname 127.0.0.1 > /tmp/serve.log 2>&1 &
for i in $(seq 1 60); do curl -sf -u "opencode:$OPENCODE_SERVER_PASSWORD" http://127.0.0.1:4096/doc -o /dev/null && break; sleep 1; done
curl -sf -u "opencode:$OPENCODE_SERVER_PASSWORD" -X POST "http://127.0.0.1:4096/session?directory=/tmp/p" -H 'content-type: application/json' -d '{"title":"warm"}' > /dev/null
for i in $(seq 1 90); do
  [ -d /opt/oc/config/opencode/node_modules/@opencode-ai/plugin ] && [ -f /opt/oc/cache/opencode/models.json ] && break
  sleep 1
done
sleep 5
kill %1 2>/dev/null || pkill -f "opencode serve" || true
test -d /opt/oc/config/opencode/node_modules/@opencode-ai/plugin
test -f /opt/oc/cache/opencode/models.json
rm -rf /tmp/p /tmp/wd /tmp/ws
du -sh /opt/oc/config /opt/oc/cache
