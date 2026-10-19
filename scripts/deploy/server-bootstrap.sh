#!/bin/bash
# Prepares a fresh Ubuntu 24.04 x86_64 server for Praetor (spec 11 Phase C step 3, docs/DEPLOY.md section 9): Docker
# Engine and the compose plugin from Docker's apt repository, a non-root deploy user in the docker group, ufw (22, 80,
# 443), unattended security upgrades, swap, the host tools `make up` needs (Node 22.22.0 and pnpm 10.29.1 for the web
# build, make setup, deploy-fisco and scripts/wecross/up.sh; Foundry's cast for infra/fisco/gen.sh) and the repository
# directory. Every step checks its result first ("ok: ..."), so a second run changes nothing. It never writes .env,
# holds no credentials and starts nothing: DEPLOY.md section 9 continues from here.
#
#   sudo DEPLOY_USER=praetor bash server-bootstrap.sh            # REPO_URL=git@github.com:... also clones (deploy key)
#
# Settings: DEPLOY_USER (praetor), APP_DIR (~DEPLOY_USER/praetor), REPO_URL (none: the directory is left empty),
# SWAP_GB (4; 0 skips), HOST_MTU (read from the default route's link; set it only to test the daemon.json path).
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-praetor}"
APP_DIR="${APP_DIR:-}"
REPO_URL="${REPO_URL:-}"
SWAP_GB="${SWAP_GB:-4}"
NODE_VERSION=22.22.0
NODE_SHA256=9aa8e9d2298ab68c600bd6fb86a6c13bce11a4eca1ba9b39d79fa021755d7c37
PNPM_VERSION=10.29.1
FOUNDRY_VERSION=1.7.1
FOUNDRY_SHA256=cf7e688ed0c4c48adffca788b496076e31060b67ac5afe1e43dbb5499c20c88b
DOCKER_GPG_FPR=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
# The stack's fixed Docker networks (infra/compose.yml, scripts/demo/lib.ts): a host route inside one breaks routing.
STACK_SUBNETS="10.88.0.0/16 10.89.0.0/24 10.90.0.0/24"

ok() { printf 'bootstrap: ok: %s\n' "$*"; }
done_() { printf 'bootstrap: done: %s\n' "$*"; }
skip() { printf 'bootstrap: skipped: %s\n' "$*"; }
die() { printf 'bootstrap: %s\n' "$*" >&2; exit 1; }

ip2int() { local IFS=.; set -- $1; echo $(( ($1 << 24) + ($2 << 16) + ($3 << 8) + $4 )); }

in_subnet() { # <ip> <net/len>
  local len=${2#*/} mask
  mask=$(( len == 0 ? 0 : (0xFFFFFFFF << (32 - len)) & 0xFFFFFFFF ))
  [ $(( $(ip2int "$1") & mask )) -eq $(( $(ip2int "${2%/*}") & mask )) ]
}

# Prints the destination of each `ip -4 route` line that would collide with the stack: a route inside a stack network
# (a broader one, like 10.0.0.0/8, loses to the stack's more specific bridges), or a gateway or source address inside
# one. Docker's own bridges (docker0, br-*) are the stack itself on a second run.
stack_route_conflicts() {
  local routes="$1" line dst net len s ip
  while read -r line; do
    [ -n "$line" ] || continue
    case " $line " in *" dev docker0 "* | *" dev br-"*) continue ;; esac
    read -r dst _ <<< "$line"
    for s in $STACK_SUBNETS; do
      if [ "$dst" != default ]; then
        net=${dst%/*}; len=32
        [[ $dst == */* ]] && len=${dst#*/}
        if [ "$len" -ge "${s#*/}" ] && in_subnet "$net" "$s"; then echo "$dst"; continue 2; fi
      fi
      for ip in $(grep -oE '(via|src) [0-9.]+' <<< "$line" | cut -d' ' -f2); do
        if in_subnet "$ip" "$s"; then echo "$dst"; continue 3; fi
      done
    done
  done <<< "$routes"
}

# GCP VPC networks default to MTU 1460; Docker's bridges default to 1500. Lower both the default bridge (builds) and
# every network created afterwards (the stack's), and only when the host link is below 1500.
daemon_json() {
  [ "$1" -lt 1500 ] || return 0
  printf '{\n  "mtu": %d,\n  "default-network-opts": { "bridge": { "com.docker.network.driver.mtu": "%d" } }\n}\n' "$1" "$1"
}

version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

in_container() { [ -f /.dockerenv ] || [ -f /run/.containerenv ]; }
has_systemd() { [ -d /run/systemd/system ]; }
as_user() { runuser -u "$DEPLOY_USER" -- env HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)" "$@"; }

if [ "${BOOTSTRAP_LIB:-}" = 1 ]; then return 0 2>/dev/null || exit 0; fi

[ "$(id -u)" -eq 0 ] || die "run as root: sudo bash $0"
. /etc/os-release
[ "${ID:-}" = ubuntu ] && [ "${VERSION_ID:-}" = 24.04 ] || die "expects Ubuntu 24.04 (found ${PRETTY_NAME:-unknown})"
# The FISCO node binary is the x86_64 release (infra/fisco/fetch.sh).
[ "$(uname -m)" = x86_64 ] || die "expects x86_64 (found $(uname -m)): the FISCO release binary is x86_64 only"
export DEBIAN_FRONTEND=noninteractive

# uuid-runtime: build_chain.sh (infra/fisco/gen.sh) calls uuidgen.
packages=(ca-certificates curl gnupg git make jq python3 openssl xz-utils uuid-runtime iproute2 dnsutils rsync tmux ufw unattended-upgrades)
missing=()
for p in "${packages[@]}"; do dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' || missing+=("$p"); done
if [ ${#missing[@]} -eq 0 ]; then
  ok "packages"
else
  apt-get update -q
  apt-get install -y -q --no-install-recommends "${missing[@]}"
  done_ "packages (${missing[*]})"
fi

conflicts="$(stack_route_conflicts "$(ip -4 route)")"
[ -z "$conflicts" ] || die "host routes inside the stack networks ($STACK_SUBNETS): $(echo $conflicts). Use a VPC subnet outside them (GCP default, asia-east2: 10.170.0.0/20)."

if dpkg-query -W -f='${Status}' docker-ce 2>/dev/null | grep -q 'install ok installed' && docker compose version >/dev/null 2>&1; then
  ok "docker ($(docker --version))"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc.part
  fpr="$(GNUPGHOME="$(mktemp -d)" gpg --show-keys --with-colons /etc/apt/keyrings/docker.asc.part | awk -F: '/^fpr/ { print $10; exit }')"
  [ "$fpr" = "$DOCKER_GPG_FPR" ] || die "Docker's apt key has fingerprint $fpr, expected $DOCKER_GPG_FPR"
  mv /etc/apt/keyrings/docker.asc.part /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  done_ "docker ($(docker --version))"
fi
compose="$(docker compose version --short)"
version_ge "${compose#v}" 2.24.0 || die "docker compose $compose is older than 2.24 (needed for !override and !reset)"

mtu="${HOST_MTU:-$(ip -o link show "$(ip -4 route show default | awk '{ print $5; exit }')" 2>/dev/null | sed -n 's/.* mtu \([0-9]*\) .*/\1/p')}"
want="$(daemon_json "${mtu:-1500}")"
if [ -z "$want" ]; then
  ok "daemon.json not needed (host MTU ${mtu:-unknown})"
elif [ -f /etc/docker/daemon.json ] && [ "$(cat /etc/docker/daemon.json)" = "$want" ]; then
  ok "daemon.json (MTU $mtu)"
elif [ -f /etc/docker/daemon.json ]; then
  die "/etc/docker/daemon.json exists with other settings: add \"mtu\": $mtu and default-network-opts by hand (see daemon_json in $0)"
else
  install -d /etc/docker
  printf '%s\n' "$want" > /etc/docker/daemon.json.part
  dockerd --validate --config-file /etc/docker/daemon.json.part >/dev/null
  mv /etc/docker/daemon.json.part /etc/docker/daemon.json
  if has_systemd; then systemctl restart docker; fi
  done_ "daemon.json (MTU $mtu)"
fi
if has_systemd; then
  systemctl is-enabled --quiet docker && systemctl is-active --quiet docker || systemctl enable --now docker
else
  skip "starting dockerd (no systemd here)"
fi

if id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  ok "user $DEPLOY_USER exists"
else
  # uid 1000 when free: the WeCross containers run as ${UID_GID:-1000:1000} and write infra/wecross/generated.
  if getent passwd 1000 >/dev/null; then useradd -m -s /bin/bash -U "$DEPLOY_USER"; else useradd -m -s /bin/bash -U -u 1000 "$DEPLOY_USER"; fi
  done_ "user $DEPLOY_USER created"
fi
if id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -qx docker; then ok "user $DEPLOY_USER in group docker"; else usermod -aG docker "$DEPLOY_USER"; done_ "user $DEPLOY_USER added to group docker"; fi
home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
uid_gid="$(id -u "$DEPLOY_USER"):$(id -g "$DEPLOY_USER")"
# The same SSH key as the admin who ran sudo, so `ssh <deploy user>@server` works from the laptop.
src_keys="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)/.ssh/authorized_keys"
if [ -s "$home/.ssh/authorized_keys" ]; then
  ok "ssh keys for $DEPLOY_USER"
elif [ -s "$src_keys" ] && [ "${SUDO_USER:-root}" != "$DEPLOY_USER" ]; then
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home/.ssh"
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$src_keys" "$home/.ssh/authorized_keys"
  done_ "ssh keys for $DEPLOY_USER copied from ${SUDO_USER:-root}"
else
  skip "ssh keys for $DEPLOY_USER (none to copy: use sudo -iu $DEPLOY_USER)"
fi

# Rules first, then enable: port 22 is open before the firewall starts. Docker publishes 80 and 443 through its own
# iptables chain, so the cloud firewall (GCP: tcp 22, 80, 443 only) stays the real gate.
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
for p in 22 80 443; do ufw allow "$p/tcp" >/dev/null; done
ok "firewall rules (deny incoming; allow 22, 80, 443/tcp)"
if in_container; then
  skip "enabling ufw (container: no netfilter)"
elif ufw status | grep -q '^Status: active'; then
  ok "ufw active"
else
  ufw --force enable >/dev/null
  done_ "ufw enabled"
fi

auto='APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";'
# Security updates only (Ubuntu's default origins): docker-ce comes from Docker's repository and never upgrades on its
# own, so the stack is never restarted under a demo. Automatic reboots stay off (the default).
if [ "$(cat /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null)" = "$auto" ]; then
  ok "unattended-upgrades"
else
  printf '%s\n' "$auto" > /etc/apt/apt.conf.d/20auto-upgrades
  done_ "unattended-upgrades"
fi

# 16 GB holds the stack (four FISCO nodes, four JVMs, about 15 Node services) plus up to AGENT_MAX_ACTIVE OpenCode
# instances at 350 to 850 MB each (Q35): swap absorbs a peak instead of the OOM killer.
if [ "$SWAP_GB" = 0 ]; then
  skip "swap (SWAP_GB=0)"
elif [ -n "$(swapon --show --noheadings 2>/dev/null)" ]; then
  ok "swap ($(swapon --show --noheadings | awk '{ print $1, $3 }' | tr '\n' ' '))"
elif in_container; then
  skip "swap (container)"
else
  [ -f /swapfile ] || { fallocate -l "${SWAP_GB}G" /swapfile; chmod 600 /swapfile; mkswap /swapfile >/dev/null; }
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-praetor-swap.conf
  sysctl -q -p /etc/sysctl.d/99-praetor-swap.conf
  done_ "swap (${SWAP_GB} GB /swapfile)"
fi

if [ "$(/usr/local/bin/node --version 2>/dev/null)" = "v$NODE_VERSION" ]; then
  ok "node v$NODE_VERSION"
else
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/node.tar.xz" "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz"
  echo "$NODE_SHA256  $tmp/node.tar.xz" | sha256sum -c --quiet -
  install -d "/opt/node-v$NODE_VERSION"
  tar -xJf "$tmp/node.tar.xz" -C "/opt/node-v$NODE_VERSION" --strip-components=1
  ln -sf "/opt/node-v$NODE_VERSION"/bin/{node,npm,npx,corepack} /usr/local/bin/
  rm -rf "$tmp"
  done_ "node v$NODE_VERSION"
fi
# pnpm through corepack (bundled with Node 22), the version package.json pins.
[ -x /usr/local/bin/pnpm ] || corepack enable --install-directory /usr/local/bin pnpm
if [ "$(as_user COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm --version 2>/dev/null)" = "$PNPM_VERSION" ]; then
  ok "pnpm $PNPM_VERSION"
else
  as_user COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack prepare "pnpm@$PNPM_VERSION" --activate >/dev/null
  [ "$(as_user COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm --version)" = "$PNPM_VERSION" ] || die "pnpm is not $PNPM_VERSION after corepack prepare"
  done_ "pnpm $PNPM_VERSION"
fi

# cast only: infra/fisco/gen.sh derives the FISCO admin address with it (and the smoke checks read Base). Nothing on
# the server runs forge: the Base contracts are deployed from the laptop (DEPLOY.md section 5).
if cast --version 2>/dev/null | grep -q "^cast Version: $FOUNDRY_VERSION$"; then
  ok "cast $FOUNDRY_VERSION"
else
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/foundry.tar.gz" "https://github.com/foundry-rs/foundry/releases/download/v$FOUNDRY_VERSION/foundry_v${FOUNDRY_VERSION}_linux_amd64.tar.gz"
  echo "$FOUNDRY_SHA256  $tmp/foundry.tar.gz" | sha256sum -c --quiet -
  tar -xzf "$tmp/foundry.tar.gz" -C "$tmp" cast
  install -m 0755 "$tmp/cast" /usr/local/bin/cast
  rm -rf "$tmp"
  done_ "cast $FOUNDRY_VERSION"
fi

APP_DIR="${APP_DIR:-$home/praetor}"
if [ -d "$APP_DIR/.git" ]; then
  ok "app dir $APP_DIR (repository present)"
elif [ -n "$REPO_URL" ]; then
  as_user env GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=accept-new' git clone -q "$REPO_URL" "$APP_DIR"
  done_ "app dir $APP_DIR (cloned)"
elif [ -d "$APP_DIR" ]; then
  ok "app dir $APP_DIR (empty: clone into it)"
else
  install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
  done_ "app dir $APP_DIR"
fi

echo
echo "bootstrap: finished. docker $(docker --version | cut -d' ' -f3 | tr -d ,), compose $compose, node $(/usr/local/bin/node --version), pnpm $PNPM_VERSION, cast $FOUNDRY_VERSION, host MTU ${mtu:-unknown}"
echo "bootstrap: next, as $DEPLOY_USER (sudo -iu $DEPLOY_USER):"
echo "  docker login                 # Docker Hub: anonymous pulls are limited to 10 an hour per IP"
[ -d "$APP_DIR/.git" ] || echo "  git clone <repository> $APP_DIR"
[ "$uid_gid" = 1000:1000 ] || echo "  echo UID_GID=$uid_gid >> $APP_DIR/.env   # the WeCross containers' user (default 1000:1000)"
echo "  then docs/DEPLOY.md section 9 (make setup, .env, pnpm keys, ...)"
