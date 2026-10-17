# Praetor WeChat mini program

The owner's daily screen in WeChat (spec 07): portfolio rings, status, decisions, the agent chat, and Tier-2 approvals
with Face ID or fingerprint (WeChat SOTER). Native WXML/WXSS/JS, base library 3.x, flat (no WebGL), the web app's
design tokens, English and Simplified Chinese.

## Layout

| Path | What |
|---|---|
| `project.config.json` | DevTools project: uploads only `miniprogram/`; "ES6 to ES5" and "enhance" off, `lib/protocol.js` excluded from Babel; placeholder AppID |
| `miniprogram/app.*` | Sign-in at launch (`wx.login` code, the api's `POST /mp/session`), language, tokens (`app.wxss`) |
| `miniprogram/config.js` | Api origin per environment (develop = the tunnel, trial/release = the domain). No secret. |
| `miniprogram/pages/` | home, approve, link, chat, activity, payments, settings, support |
| `miniprogram/lib/protocol.js` | Generated: the EIP-712 digests the phone recomputes (do not edit) |
| `miniprogram/lib/*.js` | Logic in plain CommonJS, tested in Node: `verify` (what the phone refuses to sign), `calls` (calldata decoding), `soter`, `api`, `session`, `models`, `rings`, `i18n`, `format`, `countdown`, `badges`, `chat`; `wx.js` is the only file that touches `wx.*` |
| `src/protocol.mjs` | Source of `lib/protocol.js` (keccak from `@noble/hashes`, hand-rolled ABI words, no BigInt literal) |
| `scripts/` | `build-protocol.mjs` (esbuild, ES2020, CommonJS), `set-api-base.mjs` (points an environment at an origin) |
| `test/` | Vitest: golden vectors, refusals, page logic against a fake `wx`, and a DevTools-build stand-in |

## Commands

```bash
pnpm --filter @praetor/miniprogram test     # all of the above (part of make test)
pnpm --filter @praetor/miniprogram build    # regenerate lib/protocol.js after editing src/protocol.mjs
pnpm --filter @praetor/miniprogram tunnel   # develop -> the URL in .run/tunnel-url
node apps/miniprogram/scripts/set-api-base.mjs release https://your.domain
```

## What the phone checks before SOTER signs

- Approval: the call hash recomputed from each displayed call must equal the request's, the request must be for the
  signed-in account, and the Tier2Approval digest recomputed here must equal the api's. The challenge is this phone's
  digest, the Face ID text comes from the decoded calldata (never the api's summary).
- Link: the owner action must be `LINK_WECHAT` with `payloadHash = keccak256(abi.encode(linkNonce))`, and its digest
  recomputed here must equal the api's.

Owner actions signed with the passkey (unlink, new standing orders, policy) stay on the web app: the mini program
copies the web app link and says so. Building and previewing on a phone: `docs/MANUAL.md` section 5.
