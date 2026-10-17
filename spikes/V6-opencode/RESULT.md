# V6: OpenCode serve, free DeepSeek model, tool lockdown, MCP, fake LLM, RSS

Run 2026-10-17 03:58 to 04:05 UTC. Files: `mcp-server.mjs` (streamable HTTP MCP, one tool, bearer), `fake-llm.mjs` (scripted OpenAI-compatible provider), `work/` and `work-fake/` (per-instance project dirs with `opencode.json`).

## Setup

```bash
npm i -g opencode-ai@1.19.3            # latest on npm (published 2026-10-16), same as Alex's
cd spikes/V6-opencode && npm install   # @modelcontextprotocol/sdk 1.30.1, zod 3.25.76
# one isolated instance: its own XDG dirs, its own project dir, basic auth from .env
OPENCODE_SERVER_PASSWORD=... XDG_CONFIG_HOME=... XDG_DATA_HOME=... XDG_STATE_HOME=... XDG_CACHE_HOME=... \
  opencode serve --port 19010 --hostname 127.0.0.1
```

## HTTP API (from the server's own OpenAPI document at `GET /doc`)

- Basic auth: user `opencode`, password `OPENCODE_SERVER_PASSWORD`; without it every route returns 401.
- `POST /session?directory=<dir>` `{title}` returns `{id: "ses_..."}`. The `directory` query parameter selects the project (and its `opencode.json`) per request, so one server can serve several directories; the agent-runner still runs one server per account for isolation (spec 05).
- `POST /session/:id/message?directory=` `{model: {providerID, modelID}, parts: [{type: "text", text}]}` blocks until the answer and returns the last assistant message (`info` + `parts`); earlier tool steps of the same turn are only in `GET /session/:id/message`.
- `POST /session/:id/prompt_async` (204) for fire-and-forget; `GET /session/status`; `POST /session/:id/abort`.
- `GET /event?directory=` and `GET /global/event`: SSE stream (`message.part.updated`, `message.part.delta`, `session.status`, `session.idle`, permission requests, ...).
- `GET /permission` and `POST /permission/:id/reply {reply: "reject"|...}`: pending tool permission requests.
- `GET /mcp` shows MCP connection status (`{"praetor": {"status": "connected"}}`); `POST /instance/dispose` reloads a directory's config.

## Free model without a key

`opencode/deepseek-v4.1-flash-free` answers **without any API key** (`OPENCODE_API_KEY` empty): "PONG" in 3.9 s, cost 0. Provider entry: `api.url = https://opencode.ai/inference/openai/v1`, npm `@ai-sdk/openai-compatible`. The paid `deepseek-v4.1-flash` is not listed without a key.

## Tool lockdown: the spec's `"tools": {"*": false}` breaks the free model

- Baseline (default config, fake token in `opencode.json`): asked to read the file, the model ran **`bash`** (`ls -la`) and **`read`** and printed `Bearer FAKE-TOKEN-V6-0123456789`. The risk in spec 05 is real.
- `"tools": {"*": false, "praetor_*": true}`: every request fails with **HTTP 403 `FreeTierError` "OpenCode's free tier can only be used from within OpenCode"**. Same with `"permission": {"*": "deny", ...}`. Bisected: `share`, `autoupdate`, `snapshot`, `lsp`, `formatter` are fine; anything that removes the built-in tools from the request trips the free-tier check.
- **`"permission": {"*": "ask", "praetor_*": "allow"}` works with the free model**: the built-in tools stay advertised (12 tools in the request), any call to them creates a permission request; rejecting it (`POST /permission/:id/reply {"reply":"reject"}`) gives the tool `error: "The user rejected permission to use this specific tool call."` and stops the turn. The read attempt produced exactly one `bash` request, rejected, nothing ran, no token leaked. The MCP tool needs no permission and runs.

## MCP over streamable HTTP with a bearer

Config: `"mcp": {"praetor": {"type": "remote", "url": "http://127.0.0.1:19011/mcp", "enabled": true, "headers": {"Authorization": "Bearer ..."}}}`. Tools appear as `praetor_<tool>`. With the free model: `praetor_get_balance` completed, answer "Your USDC balance is **5300.00**."; the MCP server logged the call; requests without the bearer get 401.

## Fake LLM for automated tests

Custom provider in `opencode.json`: `"provider": {"fake": {"npm": "@ai-sdk/openai-compatible", "options": {"baseURL": "http://127.0.0.1:19012/v1", "apiKey": "not-a-secret"}, "models": {"scripted": {"tool_call": true}}}}`, `model`/`small_model` = `fake/scripted`. The fake answered turn 1 with a streamed `tool_calls` chunk for `praetor_get_balance`, OpenCode called the real MCP tool, turn 2 (last message role `tool`) returned scripted text quoting the result. Deterministic and offline (apart from the first-start downloads below).

## Memory (RSS of the `opencode` process, fresh instance, Linux x86_64)

| Moment | RSS |
|---|---|
| Idle after boot | 342 MB (349,728 kB) |
| Peak during the first answer (fake LLM, MCP call) | 853 MB (873,852 kB) |
| After the answer | 593 MB (607,712 kB) |
| Peak during a real-model answer (second directory) | 834 MB (853,868 kB) |
| Idle 20 s later | 655 MB (670,224 kB) |

So one active agent costs about 0.6 to 0.9 GB. On the 16 GB server (shared with FISCO, WeIdentity, MySQL, services) that is roughly 8 to 12 concurrently awake agents; the 30-min idle stop matters.

## Verdict

**PASS with a config change** (no fallback needed for the model): free model works without a key; tool lockdown must use `permission: "ask"` + automatic rejection by the agent-runner instead of `tools: false`. Pins: `opencode-ai` 1.19.3 (installs `@opencode-ai/plugin` 1.19.3 at first start), `@modelcontextprotocol/sdk` 1.30.1.

## Traps (for QUESTIONS.md)

1. Disabling built-in tools (`tools: false` or `permission: deny`) makes the free model return 403 FreeTierError. Default: `"permission": {"*": "ask", "praetor_*": "allow"}`, the agent-runner subscribes to `/event` and rejects every permission request immediately, and the per-account directory holds nothing but that account's `opencode.json`; the paid model (`OPENCODE_API_KEY`) would allow `tools: false` and is the switch if the free tier changes again.
2. Defense in depth for trap 1: the static per-account MCP bearer is accepted by mcp only from the agent container's internal network (never through Caddy), the agent container has no egress except the LLM endpoint and mcp, and the token is passed with `{env:...}` substitution. Default: apply all three.
3. A rejected tool call ends the turn (`experimental.continue_loop_on_deny` is false by default). Default: keep it false; the AGENTS.md prompt says only the praetor tools exist.
4. First start downloads `models.json` (5.5 MB, models.dev) into the cache and npm-installs `@opencode-ai/plugin` into `$XDG_CONFIG_HOME/opencode/node_modules` (63 MB). Default: warm both during the agent image build and share the read-only cache across per-account instances; test `--pure` in M8.
5. RSS 0.6 to 0.9 GB per awake instance. Default: agent-runner caps concurrent instances (env `AGENT_MAX_ACTIVE`, default 8 on the 16 GB server) and queues wakes beyond it; the 30-min idle stop stays.
6. `POST /session/:id/message` returns only the final assistant message; tool steps must be read from `GET /session/:id/message` or the event stream. Default: the agent-runner streams `/event` for SSE to the api and reads the full history for audit.
