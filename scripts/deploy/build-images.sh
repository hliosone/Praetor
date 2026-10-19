#!/bin/bash
# Builds every image of the production stack on the server, without starting anything (docs/DEPLOY.md section 9):
# run it in tmux right after the clone and .env, while the rest is prepared. make up then finds every layer in the
# server's BuildKit cache. Measured on 2026-10-19 on 4 CPUs with a cold cache: 4 min 35 s for 17 of the 18 images
# (agent-runner unmeasured); the slowest steps were the WeCross release download and the three Gradle builds.
# Images are built where they run rather than shipped from the laptop: `make up` builds with --build anyway, and a
# laptop's working tree is not the server's commit (DEPLOY.md section 9).
# Docker Hub serves about ten of the base images: log in first (`docker login`), anonymous pulls stop at 10 an hour.
set -euo pipefail
cd "$(dirname "$0")/../.."
PROFILES="${PROFILES:-core chain mocks agent wecross}"
bash infra/fisco/fetch.sh
make --no-print-directory fisco-image
# The exact compose command (files, env files, profiles) make up uses on the server: PROD=1 LIVE=1.
read -r -a compose <<< "$(make --no-print-directory --eval 'print-compose: ; @echo $(COMPOSE) $(PROFILE_FLAGS)' print-compose PROD=1 LIVE=1 PROFILES="$PROFILES")"
"${compose[@]}" pull caddy mysql
"${compose[@]}" build
echo "build-images: done (profiles: $PROFILES)"
