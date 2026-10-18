# syntax=docker/dockerfile:1.10-labs@sha256:940282bab7a18daad689c238d407ad22393369ad53c6125c9c00f8be8a9da678
# agent-runner (spec 05): OpenCode 1.19.3 with its first-start downloads baked in (no runtime fetch), plus the runner.
# The base and store stages are those of infra/node-service.Dockerfile, verbatim, so BuildKit shares them.
FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS base
RUN corepack enable && install -d -o node -g node /app
USER node
RUN corepack prepare pnpm@10.29.1 --activate
WORKDIR /app

FROM base AS store
COPY --chown=node:node pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN pnpm fetch --frozen-lockfile --store-dir /home/node/.pnpm-store

FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl procps && rm -rf /var/lib/apt/lists/*
RUN npm i -g opencode-ai@1.19.3
COPY services/agent-runner/warm.sh /opt/warm.sh
RUN sh /opt/warm.sh && chown -R node:node /opt/oc
RUN corepack enable && install -d -o node -g node /app && mkdir -p /data/agents && chown node:node /data/agents
USER node
RUN corepack prepare pnpm@10.29.1 --activate
WORKDIR /app
COPY --chown=node:node --parents pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc packages/*/package.json services/*/package.json apps/*/package.json tee/*/package.json test/package.json ./
RUN --mount=type=bind,from=store,source=/home/node/.pnpm-store,target=/home/node/.pnpm-store,rw \
  pnpm install --offline --frozen-lockfile --store-dir /home/node/.pnpm-store --package-import-method=copy --filter "@praetor/agent-runner..."
COPY --chown=node:node . .
WORKDIR /app/services/agent-runner
CMD ["node", "--import", "tsx", "src/main.ts"]
