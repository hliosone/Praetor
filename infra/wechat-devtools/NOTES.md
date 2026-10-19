# WeChat DevTools on Linux

Adapted from Alex's notes in his walking skeleton (`ahuou/Praetor`, `infra/wechat-devtools/NOTES.md`).

- **Install**: community port [msojocs/wechat-web-devtools-linux](https://github.com/msojocs/wechat-web-devtools-linux) v2.02.2608080-1 (Electron, no wine, no sudo), asset `WeChat_Dev_Tools_v2.02.2608080-1_x86_64_linux.tar.gz`, sha256 `f7e3033cad77bc81760456b0a62f7c8a3b99a77ff30186deea18ff15ace9c384` (the GitHub asset digest; the maintainer publishes no checksum file). Unpacked with `--strip-components=1` into `$WECHAT_DEVTOOLS_HOME/v2.02.2608080-1` (default `~/wechat-devtools`), with a `current` symlink to it. Profile and login: `~/.config/wechat-devtools`.
- **`launch.sh`**: starts the GUI detached with the network fix (`NODE_OPTIONS=--network-family-autoselection-attempt-timeout=5000 --dns-result-order=ipv4first`; without it the QR login fails with `AggregateError ETIMEDOUT` from Europe). Log: `$WECHAT_DEVTOOLS_HOME/launch.log`. Always start DevTools this way: running `electron` directly (even `electron --version`) opens the GUI without the network fix and without `APPDATA`, and the CLI then reports the service port as closed.
- **`cli`**: wrapper around `wechat-devtools-cli` (upstream drops argv[0]; we pad it). Needs Settings > Security > Service port on (设置 > 安全设置 > 服务端口), once.
- **Project**: import `apps/miniprogram` (not `apps/miniprogram/miniprogram`). The AppID of the test account lives in `apps/miniprogram/project.private.config.json` (git-ignored); `project.config.json` keeps `touristappid` and must stay unchanged.
- **Preview**: `infra/wechat-devtools/cli preview --project "$PWD/apps/miniprogram" --qr-format image --qr-output /tmp/preview-qr.png`

Full walkthrough: `docs/MANUAL.md` section 5.
