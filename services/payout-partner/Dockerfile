# payout-partner (spec 05, mock PSP): Node for the partner, uv for the official Alipay+ MCP server, installed at build
# time with mcp pinned to 1.29.1 (an unpinned mcp crashes it, V7) so nothing is fetched at runtime.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim@sha256:e5b65587bce7de595f299855d7385fe7fca39b8a74baa261ba1b7147afa78e58
COPY --from=node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 /usr/local /usr/local
ENV UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/usr/local/bin UV_CACHE_DIR=/opt/uv-cache
RUN uv tool install ant-intl-alipayplus-mcp==1.0.1 --with 'mcp[cli]==1.29.1' && test -x /usr/local/bin/ant-intl-alipayplus-mcp
RUN corepack enable pnpm && corepack prepare pnpm@10.29.1 --activate && useradd -m -u 1000 partner
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@praetor/payout-partner..." && chown -R partner:partner /app
USER partner
WORKDIR /app/services/payout-partner
ENV ALIPAYPLUS_MCP_COMMAND=/usr/local/bin/ant-intl-alipayplus-mcp
CMD ["node", "--import", "tsx", "src/main.ts"]
