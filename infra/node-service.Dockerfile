# One recipe for every Node service (spec 05): the pnpm workspace filtered to the service and its packages.
# Build from the repo root: docker build -f infra/node-service.Dockerfile --build-arg SERVICE=bundler .
FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94
RUN corepack enable && corepack prepare pnpm@10.29.1 --activate
WORKDIR /app
COPY . .
ARG SERVICE
RUN pnpm install --frozen-lockfile --filter "@praetor/${SERVICE}..." && chown -R node:node /app
USER node
WORKDIR /app/services/${SERVICE}
CMD ["node", "--import", "tsx", "src/main.ts"]
