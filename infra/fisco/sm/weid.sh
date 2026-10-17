#!/bin/bash
# WeIdentity on the Guomi smoke chain (M15, spec 04, V3), called by run.sh after the Java smoke (the chain is up and
# the smoke's governance step has opened the WeIdentity admin's SM2 address in the deploy whitelist). Build-Tools
# e80d870 deploys with sm_crypto=1 (infra/weid/deploy.sh, WEID_SM=1, mounted over the image's copy), then the REST
# service 1.7.0 and Alex's 43-step scenario run against it. Recorded, not a gate. Uses the stack's WeIdentity images
# with its own MySQL, containers and volumes on the praetor-sm network; `weid.sh down` removes them (the Gradle cache
# volume praetor-sm-gradle is kept). Test-only keys and passwords, generated per run, stay in .run/sm.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$root"
work="$root/.run/sm"
out="$work/weid"
MYSQL_IMAGE=mysql:8.4.6@sha256:869218921e61d6c3c89820955d63cca42971f0e3e6c1e2792247bbd944ebc6e9
containers=(praetor-sm-weid-scenario praetor-sm-weid-rest praetor-sm-weid-deploy praetor-sm-mysql)
volumes=(praetor-sm-weid-out praetor-sm-weid-keys praetor-sm-weid-src)

if [ "${1:-}" = down ]; then
  docker rm -f "${containers[@]}" >/dev/null 2>&1 || true
  docker volume rm "${volumes[@]}" >/dev/null 2>&1 || true
  exit 0
fi

note() { echo "$*" | tee -a "$out/summary.txt"; }
# Files written by the root containers end up owned by the invoking user, so .run/sm stays removable.
own() { docker run --rm --entrypoint chown -v "$out:/w" praetor/weid-tools:local -R "$(id -u):$(id -g)" /w; }

mkdir -p "$out"
: >"$out/summary.txt"
for v in "${volumes[@]}" praetor-sm-gradle; do docker volume create "$v" >/dev/null; done
docker image inspect praetor/weid-tools:local >/dev/null 2>&1 || docker build -q -t praetor/weid-tools:local infra/weid
docker image inspect praetor/weid-rest:local >/dev/null 2>&1 || docker build -q -t praetor/weid-rest:local -f infra/weid/Dockerfile.rest infra/weid
docker image inspect praetor/weid-scenario:local >/dev/null 2>&1 || docker build -q -t praetor/weid-scenario:local services/identity/scenario

umask 077
pw="$(openssl rand -hex 16)"
printf 'WEID_ADMIN_KEY=%s\nMYSQL_PASSWORD_WEID=%s\n' "$(cat "$work/keys/weid.sm2")" "$pw" >"$out/deploy.env"
printf 'MYSQL_ROOT_PASSWORD=%s\nMYSQL_PASSWORD=%s\n' "$(openssl rand -hex 16)" "$pw" >"$out/mysql.env"
umask 022

docker run -d --name praetor-sm-mysql --network praetor-sm --network-alias mysql --tmpfs /var/lib/mysql \
  --env-file "$out/mysql.env" -e MYSQL_DATABASE=weid -e MYSQL_USER=weid "$MYSQL_IMAGE" >/dev/null
for _ in $(seq 60); do
  docker exec -e MYSQL_PWD="$pw" praetor-sm-mysql mysql -uweid -h127.0.0.1 -e 'select 1' weid >/dev/null 2>&1 && break
  sleep 2
done

started=$(date +%s)
note "deploy: Build-Tools e80d870, sm_crypto=1, admin $(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))["weid"])' "$work/keys/addresses.json")"
deploy_status=0
timeout -k 10 900 docker run --rm --name praetor-sm-weid-deploy --network praetor-sm --env-file "$out/deploy.env" -e WEID_SM=1 \
  -e FISCO_CHANNEL=10.97.0.10:20200 -e FISCO_RPC_URL=http://10.97.0.10:8545 \
  -v "$root/infra/weid/deploy.sh:/usr/local/bin/weid-deploy:ro" -v "$work/chain/nodes/10.97.0.10/sdk:/fisco-sdk:ro" \
  -v praetor-sm-weid-out:/weid/out -v praetor-sm-weid-src:/weid/src -v praetor-sm-gradle:/weid/gradle \
  praetor/weid-tools:local >"$out/deploy.out" 2>&1 || deploy_status=$?
docker rm -f praetor-sm-weid-deploy >/dev/null 2>&1 || true
# The deployment's addresses and the tail of Build-Tools' logs (no key material: the admin key is never logged).
docker run --rm --entrypoint bash -v praetor-sm-weid-out:/o:ro -v praetor-sm-weid-src:/s:ro -v "$out:/w" praetor/weid-tools:local -c \
  'cp /o/contracts.json /w/ 2>/dev/null; for f in compile deploy; do tail -60 /s/$f.log 2>/dev/null | grep -v -i "private" >/w/$f.log.tail; done; true'
own
note "deploy: exit $deploy_status after $(($(date +%s) - started)) s, contracts $(cat "$out/contracts.json" 2>/dev/null || echo none)"
if [ "$deploy_status" != 0 ]; then
  own
  exit 1
fi

docker run -d --name praetor-sm-weid-rest --network praetor-sm -e FISCO_CHANNEL=10.97.0.10:20200 \
  -v praetor-sm-weid-out:/weid/out:ro -v praetor-sm-weid-keys:/weid/keys praetor/weid-rest:local >/dev/null
rest_up=0
for _ in $(seq 90); do
  docker exec praetor-sm-weid-rest bash -c 'exec 3<>/dev/tcp/127.0.0.1/6001' 2>/dev/null && { rest_up=1; break; }
  sleep 2
done
note "rest: listening=$rest_up"
if [ "$rest_up" = 1 ]; then
  body='{"functionName":"createWeId","functionArg":{},"transactionArg":{},"v":"1.0.0"}'
  docker exec praetor-sm-node0 curl -s -m 60 -H 'content-type: application/json' --data "$body" \
    http://praetor-sm-weid-rest:6001/weid/api/invoke >"$out/createWeId.json" || true
  note "rest: createWeId -> $(cat "$out/createWeId.json")"
  timeout -k 10 900 docker run --rm --name praetor-sm-weid-scenario --network praetor-sm \
    -e WEID_REST=http://praetor-sm-weid-rest:6001/weid/api/invoke -e WEB3_RPC=http://10.97.0.10:8545 -e FISCO_CHANNEL=10.97.0.10:20200 \
    -v praetor-sm-weid-out:/weid/out:ro -v praetor-sm-weid-keys:/weid/keys:ro -v "$out/scenario:/scenario/out" \
    praetor/weid-scenario:local >"$out/scenario.out" 2>&1 || true
  docker rm -f praetor-sm-weid-scenario >/dev/null 2>&1 || true
  own
  res="$(ls -t "$out"/scenario/*/results.tsv 2>/dev/null | head -1)"
  pass=$(grep -c $'\tPASS\t' "$res" 2>/dev/null || true)
  fail=$(grep -c $'\tFAIL\t' "$res" 2>/dev/null || true)
  info=$(grep -c $'\tINFO\t' "$res" 2>/dev/null || true)
  note "scenario: ${pass:-0} PASS, ${fail:-0} FAIL, ${info:-0} INFO (${res#"$root"/})"
fi
docker logs praetor-sm-weid-rest 2>&1 | grep -v -i private | tail -200 >"$out/rest.log.tail" || true
rm -f "$out/deploy.env" "$out/mysql.env"
own
