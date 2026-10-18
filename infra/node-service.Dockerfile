# syntax=docker/dockerfile:1.10-labs@sha256:940282bab7a18daad689c238d407ad22393369ad53c6125c9c00f8be8a9da678
# One recipe for every Node service (spec 05): the pnpm workspace filtered to the service and its packages.
# Build from the repo root: docker build -f infra/node-service.Dockerfile --build-arg SERVICE=bundler .
# Everything runs as node, so nothing needs a chown afterwards. The services/ Dockerfiles repeat the store stage
# verbatim: BuildKit then fetches the packages once for all of them.
FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS base
RUN corepack enable && install -d -o node -g node /app
USER node
RUN corepack prepare pnpm@10.29.1 --activate
WORKDIR /app

# The packages, fetched from the lockfile alone: only a lockfile change rebuilds this stage, and the store never
# reaches the image (the install reads it through a bind mount).
FROM base AS store
COPY --chown=node:node pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN pnpm fetch --frozen-lockfile --store-dir /home/node/.pnpm-store

FROM base
# Manifests before sources: a code change keeps the installed node_modules layer and only copies the sources again.
COPY --chown=node:node --parents pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc packages/*/package.json services/*/package.json apps/*/package.json tee/*/package.json test/package.json ./
ARG SERVICE
RUN --mount=type=bind,from=store,source=/home/node/.pnpm-store,target=/home/node/.pnpm-store,rw \
  pnpm install --offline --frozen-lockfile --store-dir /home/node/.pnpm-store --package-import-method=copy --filter "@praetor/${SERVICE}..."
COPY --chown=node:node . .
WORKDIR /app/services/${SERVICE}
CMD ["node", "--import", "tsx", "src/main.ts"]
