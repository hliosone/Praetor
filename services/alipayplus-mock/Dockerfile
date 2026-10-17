# alipayplus-mock and wechatpay-mock (spec 05, labelled mocks). The Alipay+ MCP client always dials HTTPS 443 (V7): a
# self-signed certificate is made at build time; the port is never published outside the Docker network.
FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /tls && openssl req -x509 -newkey rsa:2048 -nodes -keyout /tls/key.pem -out /tls/cert.pem -days 3650 -subj "/CN=alipayplus-mock" 2>/dev/null \
  && chmod 644 /tls/key.pem /tls/cert.pem
RUN corepack enable && corepack prepare pnpm@10.29.1 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@praetor/alipayplus-mock..." && chown -R node:node /app
USER node
WORKDIR /app/services/alipayplus-mock
CMD ["node", "--import", "tsx", "src/main.ts"]
