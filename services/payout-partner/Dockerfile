# syntax=docker/dockerfile:1.10-labs@sha256:940282bab7a18daad689c238d407ad22393369ad53c6125c9c00f8be8a9da678
# payout-partner (spec 05, mock PSP): Node for the partner, uv for the official Alipay+ MCP server, installed at build
# time with mcp pinned to 1.29.1 (an unpinned mcp crashes it, V7) so nothing is fetched at runtime.
# The base and store stages are those of infra/node-service.Dockerfile, verbatim, so BuildKit shares them.
FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS base
RUN corepack enable && install -d -o node -g node /app
USER node
RUN corepack prepare pnpm@10.29.1 --activate
WORKDIR /app

FROM base AS store
COPY --chown=node:node pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN pnpm fetch --frozen-lockfile --store-dir /home/node/.pnpm-store

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim@sha256:e5b65587bce7de595f299855d7385fe7fca39b8a74baa261ba1b7147afa78e58
COPY --from=node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 /usr/local /usr/local
ENV UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/usr/local/bin UV_CACHE_DIR=/opt/uv-cache
RUN uv tool install ant-intl-alipayplus-mcp==1.0.1 --with 'mcp[cli]==1.29.1' && test -x /usr/local/bin/ant-intl-alipayplus-mcp
# partner is uid 1000 like node in the store stage, so the bind-mounted store is its own.
RUN corepack enable pnpm && useradd -m -u 1000 partner && install -d -o partner -g partner /app
USER partner
RUN corepack prepare pnpm@10.29.1 --activate
WORKDIR /app
COPY --chown=partner:partner --parents pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc packages/*/package.json services/*/package.json apps/*/package.json tee/*/package.json test/package.json ./
RUN --mount=type=bind,from=store,source=/home/node/.pnpm-store,target=/home/partner/.pnpm-store,rw \
  pnpm install --offline --frozen-lockfile --store-dir /home/partner/.pnpm-store --package-import-method=copy --filter "@praetor/payout-partner..."
COPY --chown=partner:partner . .
WORKDIR /app/services/payout-partner
ENV ALIPAYPLUS_MCP_COMMAND=/usr/local/bin/ant-intl-alipayplus-mcp
CMD ["node", "--import", "tsx", "src/main.ts"]
