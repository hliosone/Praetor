# Testing Praetor on real phones

For a teammate who tries the flows that need a human: the WeChat mini program with SOTER (Face ID, fingerprint), passkeys on a phone and web push. The goal is to **try the flows and report what works**, not to change the code: please do not push to `main`; open a GitHub issue per finding (or ask for a branch).

You run your **own copy of the stack** on your machine. It uses a local fork of Base Sepolia, so no testnet funds are needed, and `pnpm keys` creates your own keys: you never need anyone else's `.env`. The only secrets you add are your own WeChat test account's AppID and AppSecret, and they stay in your `.env`.

## What you need

- **A machine** with Docker 24 or later (Compose v2), 16 GB of RAM (24 GB is more comfortable), about 60 GB of free disk. Linux or macOS; on Windows use WSL2.
- **Tools**: git, Node 22 with pnpm 10.29.1 (`corepack enable`), Foundry 1.7.1 (`forge`, `cast`), python3, openssl, cloudflared.
- **WeChat DevTools** on macOS or Windows (the Linux port works but is fragile).
- **Phones**: an iPhone with Face ID and, if possible, an Android phone with a fingerprint reader, both with WeChat.
- **A WeChat mini program test account** (测试号, from developers.weixin.qq.com): its AppID and AppSecret. Add each tester's WeChat as a tester in its console.

## Set up (once)

1. `git clone --recurse-submodules git@github.com:hliosone/Praetor.git && cd Praetor`
2. `make setup`, then `pnpm keys` (writes `.env`, mode 600, with your own keys; it prints only public addresses).
3. In `.env`, add `MP_APPID=` and `MP_SECRET=` from your test account and set `SOTER_FAKE_TENCENT=0` (real SOTER). Never commit or share `.env`.
4. `make up`. The first run takes 20 to 40 minutes (images, the FISCO chain, WeIdentity, WeCross); later runs are quick. `make test` is optional.
5. Open https://praetor.localhost on the same machine and accept the local certificate (Caddy's internal CA). Create an account: passkey (your computer's Touch ID or Windows Hello, or your phone through the browser's QR prompt), the demo identity check, the agent, the mandate.

## Phones against your stack

1. `make tunnel` prints a `https://...trycloudflare.com` address and points the mini program's `develop` environment at it (`apps/miniprogram/miniprogram/config.js`; do not commit that change). `make tunnel-stop` ends it.
2. In WeChat DevTools, open `apps/miniprogram` with your AppID and check the settings of `docs/MANUAL.md` step 5.1 ("ES6 to ES5" off for `lib/protocol.js`).
3. Follow `docs/MANUAL.md` section 5, steps 5.3 to 5.8: preview on the phones in debug mode, the SOTER support probe, link WeChat from the web app's QR code, approve a payment with Face ID and compare the digest shown on the phone with the web app, the fingerprint on Android, unlink.
4. If time allows: section 11 (web push on a phone) and section 8 (the judges' sandbox).

Passkeys belong to a host name: the ones created on `praetor.localhost` work only in that machine's browser. That does not affect the mini program, which signs with SOTER.

## What to report

One issue per step, titled with the step (for example "MANUAL 5.6: Face ID approval on iPhone"), with:

| Field | Example |
|---|---|
| Phone, OS, WeChat version | iPhone 15, iOS 18.1, WeChat 8.0.54 |
| What you did | Linked from the web app QR, then approved the 3 USDC payment |
| What you saw | "Approved" on the phone, "executed" in the web app |
| Result | works / fails / partly |
| Evidence | screenshot, the vConsole error text, the transaction hash |

Never paste keys, `.env` values or personal data in an issue.

## Known limits (no need to report)

- The mini program runs only under the test account and in debug mode (publication needs a registered company and an ICP filing).
- SOTER's counter may not increase on iOS; Praetor records it but every approval digest is single-use anyway (self-assessment, risk 16).
- Without `MP_APPID` and `MP_SECRET` the stack uses a fake Tencent: the screens and the flow work, real SOTER verification does not.
- WeChat Official Account notifications need the OA test account; until then they go to a log.
