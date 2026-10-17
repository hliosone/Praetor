# WeCross transport: security notes (M12, D42)

WeCross carries consortium attestations from FISCO to Base. It is untrusted (spec 01): it can delay or withhold a
message, never forge one, because MandateHook and Anchor verify the member signatures themselves.

- **Keys.** WeCross holds only its own keys: `WECROSS_FISCO_KEY` (the router account of `MemberRegistry`, the only
  account `BaseOutbox.requestWeCross` accepts) and `WECROSS_BASE_KEY` (pays gas on Base). No member key enters the
  router or the account manager. The bridge-relayer holds `WECROSS_FISCO_KEY` in `BRIDGE=wecross` mode to send the
  requests; both are transport keys.
- **Silence.** A message WeCross does not apply within `BRIDGE_WATCHDOG_S` is delivered by the relayer; without
  heartbeats the agent becomes RESTRICTED (I4). One undeliverable request can stall the hub queue (V4, Q38): the
  watchdog does not depend on hub progress.
- **Hub setters.** `WeCrossHub.updateCurrentRequestIndex` and `registerCallbackResult` have no access control (V4,
  Q39): a FISCO account could skip queued requests. The watchdog still delivers them; `BaseOutbox.onDelivered` is a
  hint only and changes no state beyond an event.
- **Router logs.** When the router fails to build a chain account it logs the account's properties, private key
  included (WeCross 1.4.0, `UniversalAccountFactory`). The logs stay in `infra/wecross/generated` (git-ignored,
  owner-only); in production the router's log level and retention must keep them on the CVM only.
- **Network.** The router RPC is plain HTTP on the Docker network and never published; its login is the WeCross SDK's
  (salted SHA-256 password, RSA PKCS#1 v1.5). The account manager keeps TLS.
- **Patched code.** The vendored Base proxy (BFS replaced by an owner-set map) and one recompiled account manager class
  (the "EVM" chain account type) are the only changes to WeCross code; the EVM stub is new code (spec 08 item 8).
