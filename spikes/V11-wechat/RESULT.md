# V11: WeChat mini program (SOTER, wx.login, debug mode) and Official Account templates

Run 2026-10-17 04:20 UTC. Desk check only: `.env` has `MP_APPID`, `MP_SECRET`, `OA_APPID`, `OA_SECRET`, `OA_TOKEN`, `OA_TEMPLATE_ID` all empty, and WeChat DevTools (Linux port) is not installed on this machine.

## What was checked

| Item | Source | Result |
|---|---|---|
| `api.weixin.qq.com` reachable from this machine | `GET /cgi-bin/token` with a dummy app id | HTTP 200 in 1.5 s, `{"errcode":40013,"errmsg":"invalid appid"}`: the API answers; credentials are the only missing piece |
| SOTER Face ID on iPhone in a mini program test account | Alex, `docs/praetor-soter-final-report-2026-10-17.md` (iPhone 15, iOS 27.0.1, WeChat 8.0.79, base library 3.17.4) | `supportMode: ["facial"]`; `startSoterAuthentication` ok; `raw == challenge` (64 lowercase hex, first field); iOS `resultJSON` = `raw, counter, uid, cpu_id` only (175 bytes); RSA-2048 signature |
| `verify_signature` | same | `is_ok: true` with the **mini program** test account credentials; tampered copy `is_ok: false`; with Official Account credentials `48001 api unauthorized` |
| Fingerprint mode on Face ID iPhones | same | errCode 90003 (mode not supported): the mode must come from `supportMode` |
| `wx.login` + `code2Session` | Alex's `services/approvals/soter/server/server.js` and miniprogram `app.js` | works with the mini program test account |
| Debug mode | Alex, `docs/WECHAT_SETUP.md` | without "open debug" on the phone every request fails `url not in domain list`; DevTools `urlCheck:false` only applies inside DevTools |
| DevTools on Linux | Alex, `infra/wechat-devtools/NOTES.md` | community port msojocs v2.02.2608080-1; login needs `NODE_OPTIONS=--network-family-autoselection-attempt-timeout=5000 --dns-result-order=ipv4first`; CLI needs the Service Port on once |
| OA test account messages | Alex, test report row 6 | customer-service text message both ways works (inside the 48 h window after the user writes); template messages not tested by Alex |
| OA test account templates | WeChat sandbox docs | the test account page lets you add test templates (`模板消息接口`); the template id goes into `OA_TEMPLATE_ID` |

## Verdict

**PENDING MP_APPID/MP_SECRET and OA_* (human values)**. Alex's results prove the SOTER path on a real iPhone with a mini program test account; nothing contradicts the spec. Fallback for notifications as planned: plain customer-service text messages if template messages fail on the test account.

## Traps for the build

1. `verify_signature` only with the mini program test account (`MP_*`), never the OA credentials (48001).
2. One WeChat account per phone: the human whose phone runs Phase C must provide the `MP_*` values of **their own** mini program test account (test accounts are tied to the WeChat account that created them), and add teammates as testers.
3. Test-account OA messages cannot open the mini program: the message tells the user to open it, or links the web approval page (spec 05 already says so).
4. Customer-service messages need the user to have written to the OA within 48 h; template messages do not. Default: template messages for approvals and refusals once `OA_TEMPLATE_ID` exists, customer-service text otherwise.
5. DevTools is a Phase C (human) step: QR login cannot be automated; M14 builds and unit-tests the mini program logic, and the DevTools CLI build runs only if the human installs and logs in.
