# syntax=docker/dockerfile:1.10-labs@sha256:940282bab7a18daad689c238d407ad22393369ad53c6125c9c00f8be8a9da678
# alipayplus-mock and wechatpay-mock (spec 05, labelled mocks). The Alipay+ MCP client always dials HTTPS 443 (V7): a
# self-signed certificate is made at build time; the port is never published outside the Docker network.
# The base and store stages are those of infra/node-service.Dockerfile, verbatim, so BuildKit shares them.
FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS base
RUN corepack enable && install -d -o node -g node /app
USER node
RUN corepack prepare pnpm@10.29.1 --activate
WORKDIR /app

FROM base AS store
COPY --chown=node:node pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN pnpm fetch --frozen-lockfile --store-dir /home/node/.pnpm-store

FROM base
USER root
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /tls && openssl req -x509 -newkey rsa:2048 -nodes -keyout /tls/key.pem -out /tls/cert.pem -days 3650 -subj "/CN=alipayplus-mock" 2>/dev/null \
  && chmod 644 /tls/key.pem /tls/cert.pem
USER node
COPY --chown=node:node --parents pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc packages/*/package.json services/*/package.json apps/*/package.json tee/*/package.json test/package.json ./
RUN --mount=type=bind,from=store,source=/home/node/.pnpm-store,target=/home/node/.pnpm-store,rw \
  pnpm install --offline --frozen-lockfile --store-dir /home/node/.pnpm-store --package-import-method=copy --filter "@praetor/alipayplus-mock..."
COPY --chown=node:node . .
WORKDIR /app/services/alipayplus-mock
CMD ["node", "--import", "tsx", "src/main.ts"]
