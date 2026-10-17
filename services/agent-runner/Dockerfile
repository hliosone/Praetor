# agent-runner (spec 05): OpenCode 1.19.3 with its first-start downloads baked in (no runtime fetch), plus the runner.
FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl procps && rm -rf /var/lib/apt/lists/*
RUN npm i -g opencode-ai@1.19.3
COPY services/agent-runner/warm.sh /opt/warm.sh
RUN sh /opt/warm.sh && chown -R node:node /opt/oc
RUN corepack enable && corepack prepare pnpm@10.29.1 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@praetor/agent-runner..." && chown -R node:node /app && mkdir -p /data/agents && chown node:node /data/agents
USER node
WORKDIR /app/services/agent-runner
CMD ["node", "--import", "tsx", "src/main.ts"]
