#!/usr/bin/env bash
# V7 reproduction: fake gateway + the real ant-intl-alipayplus-mcp 1.0.1 over MCP stdio, both in containers.
# Uses throwaway test keys and a self-signed cert under .run/V7 (never the .env keys).
set -euo pipefail
cd "$(dirname "$0")/../.."
IMG=ghcr.io/astral-sh/uv:python3.12-bookworm-slim
W=.run/V7; mkdir -p $W/certs
openssl req -x509 -newkey rsa:2048 -nodes -keyout $W/certs/key.pem -out $W/certs/cert.pem -days 30 -subj /CN=alipayplus-mock 2>/dev/null
for k in m g; do openssl genrsa -out $W/$k.pem 2048 2>/dev/null
  openssl pkcs8 -topk8 -nocrypt -in $W/$k.pem -outform DER | base64 -w0 >$W/$k.pkcs8.b64
  openssl rsa -in $W/$k.pem -pubout -outform DER 2>/dev/null | base64 -w0 >$W/$k.pub.b64; done
docker network create p0v7 >/dev/null 2>&1 || true
docker rm -f p0v7-gw >/dev/null 2>&1 || true
docker run -d --name p0v7-gw --network p0v7 --network-alias alipayplus-mock -v "$PWD/spikes/V7-alipayplus":/spike:ro -v "$PWD/$W/certs":/certs:ro \
  -e GATEWAY_PRIVATE_KEY="$(cat $W/g.pkcs8.b64)" -e MERCHANT_PUBLIC_KEY="$(cat $W/m.pub.b64)" $IMG \
  uv run --no-project --with cryptography==44.0.3 python /spike/gateway.py >/dev/null
sleep 8
docker run --rm --network p0v7 -v "$PWD/spikes/V7-alipayplus":/spike:ro \
  -e MERCHANT_PRIVATE_KEY="$(cat $W/m.pkcs8.b64)" -e GATEWAY_PUBLIC_KEY="$(cat $W/g.pub.b64)" $IMG \
  sh -c "uv run --no-project --with 'mcp==1.29.1' python /spike/client.py uvx --from ant-intl-alipayplus-mcp==1.0.1 --with 'mcp[cli]==1.29.1' ant-intl-alipayplus-mcp" \
  2>&1 | grep -E '^(tools|create_payment|query_payment)'
docker rm -f p0v7-gw >/dev/null; docker network rm p0v7 >/dev/null
