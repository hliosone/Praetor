#!/bin/bash
# Adapted from Alex's walking skeleton (ahuou/Praetor infra/wechat-devtools/launch.sh), see docs/PREEXISTING.md.
# Node tries each server address for only 250 ms by default; WeChat's Hong Kong servers take longer from Europe,
# so the QR login failed with AggregateError ETIMEDOUT. Give each attempt 5 s and prefer IPv4.
export NODE_OPTIONS="--network-family-autoselection-attempt-timeout=5000 --dns-result-order=ipv4first"
setsid nohup "${WECHAT_DEVTOOLS_HOME:-$HOME/wechat-devtools}/current/bin/wechat-devtools" > "${WECHAT_DEVTOOLS_HOME:-$HOME/wechat-devtools}/launch.log" 2>&1 < /dev/null &
