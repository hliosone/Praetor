#!/bin/bash
# make tunnel (spec 11, phones against the local stack): a cloudflared quick tunnel in front of Caddy, with the flags
# that worked in Phase 0 (HTTP/2, IPv4). cloudflared terminates TLS on its public address and reaches Caddy over plain
# HTTP on this machine (the Caddyfile's tunnel site), so the stack can move PUBLIC_HOST to the tunnel's address for
# passkeys on a phone without the tunnel changing. The URL goes to .run/tunnel-url and into the mini program's develop
# base. One instance; `make tunnel-stop` ends it.
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p .run
if [ -f .run/tunnel.pid ] && kill -0 "$(cat .run/tunnel.pid)" 2>/dev/null; then
  echo "tunnel already running: $(cat .run/tunnel-url 2>/dev/null)"
  exit 0
fi
: > .run/tunnel.log
nohup cloudflared tunnel --no-autoupdate --protocol http2 --edge-ip-version 4 --url http://localhost:80 > .run/tunnel.log 2>&1 &
echo $! > .run/tunnel.pid
url=""
for _ in $(seq 1 60); do
  url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' .run/tunnel.log | head -1 || true)"
  [ -n "$url" ] && break
  sleep 1
done
[ -n "$url" ] || { echo "tunnel: no URL after 60 s, see .run/tunnel.log" >&2; exit 1; }
echo "$url" > .run/tunnel-url
pnpm -s --filter @praetor/miniprogram tunnel
echo "tunnel: $url (mini program develop base set)"
echo "passkeys on a phone: set PUBLIC_HOST=${url#https://} and PUBLIC_URL=$url in .env, then make up (docs/TESTER.md)"
