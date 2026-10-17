# V8: Pyth Hermes

Run 2026-10-17 03:48 UTC (Saturday; metals market closed).

## Commands

```bash
spikes/V8-pyth/probe.sh                               # https://pyth.dourolabs.app/hermes, no key
spikes/V8-pyth/probe.sh https://hermes.pyth.network   # public host, no key
curl "https://hermes.pyth.network/v2/price_feeds?query=xau&asset_type=metal"   # metadata
curl "https://hermes.pyth.network/v2/price_feeds?query=xag&asset_type=metal"
```

## Seen

- `GET /v2/updates/price/latest?ids[]=...&parsed=true` on **both** `pyth.dourolabs.app/hermes` and `hermes.pyth.network`: `HTTP/2 401`, body `unauthorized` (text/plain, 12 bytes), served by Cloudflare. The legacy `/api/latest_price_feeds` also returns 401. `benchmarks.pyth.network/v1/updates/price/<ts>` returns 401 too.
- The metadata endpoint `/v2/price_feeds` is keyless and confirms both feed ids of spec 00:
  - `765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2` = `XAUUSD` "GOLD / US DOLLAR"
  - `f2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e` = `XAGUSD` "SILVER / US DOLLAR"
- Metadata also returns `market_hours {is_open, next_open, next_close}` and the trading schedule (America/New_York, closed Friday 17:00 to Sunday 18:00). At the time of the run `is_open = false`, `next_open = 1792360800` (Sunday 2026-10-18 22:00 UTC). This confirms the spec's weekend reasoning (`maxPriceAge` 4 days).

## Normalisation to 8 decimals (spec 02)

Hermes returns `price` (integer string) and `expo` (negative). `price8 = price * 10^(expo + 8)` when `expo >= -8`, else `price / 10^(-8 - expo)` truncated. Implemented in `probe.sh`; to be confirmed against real values once the key is present.

## Verdict

**PENDING PYTH_API_KEY.** No keyless price endpoint works. Fallback until the key arrives: last known prices seeded by hand and pushed with `source = DEMO`, flagged "demo price" in every UI (spec 10 table).

## Traps (for QUESTIONS.md)

1. Hermes price endpoints now require `Authorization: Bearer <key>` on every host, including the public `hermes.pyth.network`. Default if no key: oracle-feeder starts in "seeded" mode with fixed prices (XAU, XAG from a config file) pushed as `source = DEMO`; the UI shows "demo price".
2. The keyless `/v2/price_feeds` metadata gives `market_hours.is_open`; the feeder can use it to explain stale weekend prices in the UI. Default: use it for display only, never for authority (the hook relies on `maxPriceAge`).
