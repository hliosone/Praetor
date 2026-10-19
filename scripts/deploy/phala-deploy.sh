#!/bin/bash
# The two TEEs on Phala Cloud (spec 11 Phase C step 5, docs/DEPLOY.md sections 7 and 8). Spends money and publishes
# images: refuses to run unless PHALA_CONFIRM=1.
#
#   PHALA_CONFIRM=1 REGISTRY=ghcr.io/<owner> scripts/deploy/phala-deploy.sh build
#       Builds agent-signer and soter-attester (infra/node-service.Dockerfile) from the committed tree (git archive
#       HEAD: no untracked file, no uncommitted change), pushes them and writes their digests to $OUT_DIR/images.env.
#       Log in to the registry first (docker login).
#   PHALA_CONFIRM=1 PUBLIC_URL=https://app.<domain> scripts/deploy/phala-deploy.sh deploy
#       Renders infra/phala/<service>.compose.yml with those digests and the URL, then creates (or, when a CVM of that
#       name exists, updates) the CVMs praetor-agent-signer and praetor-soter-attester: tdx.small, production OS
#       image, private logs. Each CVM gets only its own secrets from $ENV_FILE as encrypted env, plus the registry
#       login when $ENV_FILE has DSTACK_DOCKER_REGISTRY/USERNAME/PASSWORD (a private image).
#   Without a mode: build, then deploy.
#
# Run it on the laptop (it has phala, the API key and the registry login). ENV_FILE (default .env) must hold the values
# the server's .env holds: the CVMs and the server share the four TEE HMACs, so DEPLOY.md section 9 copies them with
# MP_* from the laptop's .env into the server's before pnpm keys. Changing only these values later keeps the compose
# hash (allowed_envs lists names, not values). PHALA_CLOUD_API_KEY comes from the shell, else from .env. Secrets are never printed; the env files given to phala are
# deleted on exit. The rendered compose files and phala's answers stay in $OUT_DIR (.run/phala) for the record.
set -euo pipefail
cd "$(dirname "$0")/../.."

die() { printf 'phala-deploy: %s\n' "$*" >&2; exit "${2:-1}"; }
[ "${PHALA_CONFIRM:-}" = 1 ] || die "spends Phala credit and pushes images: run with PHALA_CONFIRM=1 (nothing done)" 2

mode="${1:-all}"
OUT_DIR="${OUT_DIR:-.run/phala}"
ENV_FILE="${ENV_FILE:-.env}"
SERVICES=(agent-signer soter-attester)
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

# The value of NAME in an env file, without echoing it anywhere.
val() { grep -E "^$1=" "$2" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
var_of() { local v="${1^^}"; echo "${v//-/_}_IMAGE"; }
secrets_of() {
  case "$1" in
    agent-signer) echo SIGNER_HMAC_MCP SIGNER_HMAC_API SIGNER_HMAC_BANK ;;
    soter-attester) echo ATTESTER_HMAC_API MP_APPID MP_SECRET ;;
  esac
}

build() {
  [ -n "${REGISTRY:-}" ] || die "set REGISTRY (for example ghcr.io/<owner>): where Phala pulls the images from"
  local sha src svc meta digest remote images=()
  sha="$(git rev-parse --short=12 HEAD)"
  src="$OUT_DIR/src"
  rm -rf "$src" && mkdir -p "$src"
  git archive HEAD | tar -x -C "$src"
  echo "phala-deploy: building commit $sha (soter-attester bakes infra/deployments/base-sepolia.json, mandateHook $(jq -r .mandateHook "$src/infra/deployments/base-sepolia.json"))"
  for svc in "${SERVICES[@]}"; do
    meta="$OUT_DIR/$svc.build.json"
    docker buildx build -f "$src/infra/node-service.Dockerfile" --build-arg "SERVICE=$svc" -t "$REGISTRY/praetor-$svc:$sha" \
      --label "org.opencontainers.image.revision=$sha" --platform linux/amd64 --provenance=false --sbom=false --push \
      --metadata-file "$meta" "$src"
    digest="$(jq -r '."containerimage.digest"' "$meta")"
    [[ $digest =~ ^sha256:[0-9a-f]{64}$ ]] || die "no image digest for $svc in $meta"
    # The CVM pulls by this digest at boot: check it is what the registry serves, not only what BuildKit reported.
    remote="$(docker buildx imagetools inspect "$REGISTRY/praetor-$svc:$sha" --format '{{.Manifest.Digest}}')"
    [ "$remote" = "$digest" ] || die "the registry serves $remote for praetor-$svc:$sha, not the built $digest"
    images+=("$(var_of "$svc")=$REGISTRY/praetor-$svc@$digest")
  done
  printf '%s\n' "${images[@]}" "SOURCE_COMMIT=$sha" > "$OUT_DIR/images.env"
  echo "phala-deploy: pushed; digests in $OUT_DIR/images.env"
}

deploy() {
  local images="$OUT_DIR/images.env" svc name ref rendered envf n v reg
  [ -f "$images" ] || die "no $images: run the build first"
  [[ ${PUBLIC_URL:-} =~ ^https://[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] && [ "$PUBLIC_URL" != https://praetor.localhost ] \
    || die "set PUBLIC_URL to the deployment's origin, https://app.<domain> (no path, no trailing slash): got '${PUBLIC_URL:-}'"
  [ -f "$ENV_FILE" ] || die "no secrets file $ENV_FILE (ENV_FILE)"
  PHALA_CLOUD_API_KEY="${PHALA_CLOUD_API_KEY:-$(val PHALA_CLOUD_API_KEY .env)}"
  [ -n "$PHALA_CLOUD_API_KEY" ] || die "no PHALA_CLOUD_API_KEY in the shell or in .env"
  export PHALA_CLOUD_API_KEY
  # Check everything before the first CVM, so a missing value never leaves one CVM deployed without the other.
  for svc in "${SERVICES[@]}"; do
    ref="$(val "$(var_of "$svc")" "$images")"
    [[ $ref =~ ^[a-z0-9./_-]+@sha256:[0-9a-f]{64}$ ]] || die "$(var_of "$svc") in $images must be an image by digest (<registry>/<name>@sha256:...): got '$ref'"
    for n in $(secrets_of "$svc"); do
      v="$(val "$n" "$ENV_FILE")"
      [ -n "$v" ] || die "$n is empty in $ENV_FILE"
      case "$n" in *HMAC*) [ ${#v} -ge 32 ] || die "$n in $ENV_FILE is shorter than 32 characters" ;; esac
    done
  done
  trap 'rm -f "$OUT_DIR"/agent-signer.env "$OUT_DIR"/soter-attester.env' EXIT
  for svc in "${SERVICES[@]}"; do
    name="praetor-$svc"
    ref="$(val "$(var_of "$svc")" "$images")"
    rendered="$OUT_DIR/$svc.compose.yml"
    sed -e "s|__$(var_of "$svc")__|$ref|" -e "s|__PUBLIC_URL__|$PUBLIC_URL|" "infra/phala/$svc.compose.yml" > "$rendered"
    ! grep -qE '__[A-Z_]+__' "$rendered" || die "placeholder left in $rendered"
    envf="$OUT_DIR/$svc.env"
    (
      umask 077
      : > "$envf"
      for n in $(secrets_of "$svc"); do echo "$n=$(val "$n" "$ENV_FILE")" >> "$envf"; done
      # A private image: the CVM's pre-launch script logs in with these before pulling.
      if [ -n "$(val DSTACK_DOCKER_PASSWORD "$ENV_FILE")" ]; then
        for reg in DSTACK_DOCKER_REGISTRY DSTACK_DOCKER_USERNAME DSTACK_DOCKER_PASSWORD; do echo "$reg=$(val "$reg" "$ENV_FILE")" >> "$envf"; done
      fi
    )
    if phala cvms get "$name" >/dev/null 2>&1; then
      echo "phala-deploy: updating $name (its compose hash changes: allowlist the new one, DEPLOY.md section 8)"
      phala deploy --cvm-id "$name" -c "$rendered" -e "$envf" --no-public-logs --wait --json > "$OUT_DIR/$svc.deploy.json"
    else
      echo "phala-deploy: creating $name"
      phala deploy -n "$name" -c "$rendered" -e "$envf" -t "${PHALA_INSTANCE_TYPE:-tdx.small}" --no-dev-os --no-public-logs --wait --json \
        --image "${PHALA_OS_IMAGE:-dstack-0.5.12}" > "$OUT_DIR/$svc.deploy.json"
    fi
    rm -f "$envf"
  done
  echo "phala-deploy: done; phala's answers in $OUT_DIR/*.deploy.json. Next (DEPLOY.md section 8):"
  echo "  phala cvms get praetor-agent-signer --json; phala cvms get praetor-soter-attester --json   # app id, compose hash, gateway URL"
}

case "$mode" in
  build) build ;;
  deploy) deploy ;;
  all) build && deploy ;;
  *) die "unknown mode '$mode' (build, deploy, or none for both)" ;;
esac
