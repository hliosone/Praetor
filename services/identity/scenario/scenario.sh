#!/usr/bin/env bash
# WeIdentity feasibility scenario (steps a-k) against the ALREADY deployed WeIdentity
# contracts on the local FISCO BCOS 3.17.1 chain. Re-runnable: every run creates fresh
# WeIDs / CPTs / credentials, tagged with RUN (epoch seconds).
#
# Vocabulary:
#   WeID        = W3C DID of form did:weid:<weid chain id>:<address> (chain id here = 101)
#   CPT         = "Claim Protocol Type": a JSON-schema credential template stored on chain
#   invokerWeId = REST "key index": the REST service looks up a HOSTED private key file by
#                 this WeID's address (dist/keys/<addr>), or the admin key if it equals
#                 default.passphrase. i.e. the REST service is a custodial signer.
#   evidence    = on-chain record of a credential hash + per-signer signature/logs/revoked flag
#
# Phases:  1) REST   2) Java SDK (things REST does not expose)   3) REST read-backs + negatives
# Output:  out/<RUN>/*.json, out/<RUN>/results.tsv (step, path, PASS/FAIL, tx hashes, note)
set -uo pipefail

# Praetor (M6): runs in the weid-scenario container against weid-rest; the REST service's custodial keys and the
# deployment's admin key come from the shared volumes (REST_KEYS_DIR, ADMIN_KEY_FILE).
SPIKE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)   # outputs go to ./out (container-local)
REST_KEYS_DIR=${REST_KEYS_DIR:-/weid/keys}
ADMIN_KEY_FILE=${ADMIN_KEY_FILE:-/weid/out/private_key}
REST=${WEID_REST:-http://127.0.0.1:6001/weid/api/invoke}
WEB3=${WEB3_RPC:-http://127.0.0.1:8545}
RUN=${RUN:-$(date +%s)}
OUT=$SPIKE/out/$RUN
mkdir -p "$OUT" "$SPIKE/out/secrets"; chmod 700 "$SPIKE/out/secrets"
RES=$OUT/results.tsv
: > "$RES"
ln -sfn "$OUT" "$SPIKE/out/latest"

# Admin "key index" for the REST service (value of default.passphrase). Read, never printed.
ADMIN_INVOKER=${ADMIN_INVOKER:-private_key}

log()    { printf '\n=== %s\n' "$*"; }
result() { printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" | tee -a "$RES"; }
blk()    { curl -s -X POST "$WEB3" -H 'content-type: application/json' \
             -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | jq -r '.result' | xargs printf '%d'; }
# tx hashes in blocks (from, to], optionally only those sent by $3 (address, case-insensitive)
txs_between() {
  local from=$1 to=$2 who=${3:-} n out=()
  for ((n=from+1; n<=to; n++)); do
    while read -r h f; do
      [[ -z "$h" ]] && continue
      if [[ -z "$who" || "${f,,}" == "${who,,}" ]]; then out+=("$h"); fi
    done < <(curl -s -X POST "$WEB3" -H 'content-type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getBlockByNumber\",\"params\":[\"$(printf '0x%x' $n)\",true]}" \
      | jq -r '.result.transactions[]? | "\(.hash) \(.from)"')
  done
  local IFS=,; echo "${out[*]:-}"
}
# rest <file-stem> <functionName> <functionArg-json> <transactionArg-json>  -> body in $OUT/<stem>.json
rest() {
  local stem=$1 fn=$2 farg=$3 targ=$4
  jq -n --arg fn "$fn" --argjson fa "$farg" --argjson ta "$targ" \
     '{functionName:$fn, functionArg:$fa, transactionArg:$ta, v:"1.0.0"}' > "$OUT/$stem.req.json"
  curl -s -X POST "$REST" -H 'content-type: application/json' --data @"$OUT/$stem.req.json" > "$OUT/$stem.json"
  # redact the admin key index if it ever appears in a saved request
  sed -i "s/\"$ADMIN_INVOKER\"/\"<ADMIN_INVOKER>\"/g" "$OUT/$stem.req.json"
  jq -c '{errorCode, errorMessage, respBody: (.respBody|tostring|.[0:160])}' "$OUT/$stem.json"
}
code() { jq -r '.errorCode' "$OUT/$1.json"; }
body() { jq -r '.respBody' "$OUT/$1.json"; }
addr() { echo "${1##*:}"; }

curl -s -o /dev/null -m 3 "${REST%/weid/api/invoke}/" || { echo "REST service not reachable at $REST"; exit 1; }

############################################ PHASE 1: REST
log "a1 create bank WeID (REST createWeId)"
b0=$(blk); rest a1_createWeId_bank createWeId '{}' '{}'; b1=$(blk)
BANK=$(body a1_createWeId_bank)
[[ $(code a1_createWeId_bank) == 0 ]] && result a1 REST PASS "$(txs_between $b0 $b1)" "bank=$BANK" || result a1 REST FAIL "" "$(jq -c . $OUT/a1_createWeId_bank.json)"

log "d create user WeID (REST createWeId)"
b0=$(blk); rest d_createWeId_user createWeId '{}' '{}'; b1=$(blk)
USER=$(body d_createWeId_user)
[[ $(code d_createWeId_user) == 0 ]] && result d REST PASS "$(txs_between $b0 $b1)" "user=$USER" || result d REST FAIL "" "$(jq -c . $OUT/d_createWeId_user.json)"

log "a2 register bank as Authority Issuer (REST registerAuthorityIssuer, invoker=admin)"
BANK_NAME=${BANK_NAME:-Demo Bank}
b0=$(blk); rest a2_registerAuthorityIssuer registerAuthorityIssuer \
  "$(jq -n --arg w "$BANK" --arg n "$BANK_NAME" '{weId:$w,name:$n}')" "$(jq -n --arg i "$ADMIN_INVOKER" '{invokerWeId:$i}')"; b1=$(blk)
if [[ $(code a2_registerAuthorityIssuer) != 0 ]]; then
  # names are unique on chain; on re-runs "Demo Bank" is taken -> suffix the run tag
  BANK_NAME="Demo Bank $RUN"
  b0=$(blk); rest a2_registerAuthorityIssuer registerAuthorityIssuer \
    "$(jq -n --arg w "$BANK" --arg n "$BANK_NAME" '{weId:$w,name:$n}')" "$(jq -n --arg i "$ADMIN_INVOKER" '{invokerWeId:$i}')"; b1=$(blk)
fi
[[ $(code a2_registerAuthorityIssuer) == 0 ]] && result a2 REST PASS "$(txs_between $b0 $b1)" "name='$BANK_NAME'" || result a2 REST FAIL "" "$(jq -c . $OUT/a2_registerAuthorityIssuer.json)"

log "a2b admin RECOGNIZES the bank (REST recognizeAuthorityIssuer). In 3.x registration alone leaves the issuer 'unrecognized'"
b0=$(blk); rest a2b_recognizeAuthorityIssuer recognizeAuthorityIssuer "$(jq -n --arg w "$BANK" '{weId:$w}')" \
  "$(jq -n --arg i "$ADMIN_INVOKER" '{invokerWeId:$i}')"; b1=$(blk)
rest a2_queryAuthorityIssuer queryAuthorityIssuer "$(jq -n --arg w "$BANK" '{weId:$w}')" '{}' >/dev/null
[[ $(code a2b_recognizeAuthorityIssuer) == 0 && $(jq -r '.respBody.recognized' $OUT/a2_queryAuthorityIssuer.json) == true ]] \
  && result a2b REST PASS "$(txs_between $b0 $b1)" "recognized=true" || result a2b REST FAIL "$(txs_between $b0 $b1)" "$(jq -c . $OUT/a2b_recognizeAuthorityIssuer.json)"

log "b register CPT PersonKYC (REST registerCpt, invoker=bank)"
KYC_SCHEMA=$(cat <<'EOF'
{"title":"PersonKYC","description":"KYC attestation issued by a bank","type":"object",
 "properties":{
  "holder":{"type":"string","description":"WeID of the person (credential subject)"},
  "ageOver18":{"type":"boolean","description":"person is 18 or older"},
  "jurisdiction":{"type":"string","description":"ISO 3166-1 alpha-2 code, e.g. HK","pattern":"^[A-Z]{2}$"},
  "riskProfile":{"type":"string","enum":["conservative","balanced","growth"]},
  "sanctionsScreened":{"type":"string","format":"date","description":"date of last sanctions screening"},
  "kycLevel":{"type":"integer","minimum":0}},
 "required":["holder","ageOver18","jurisdiction","riskProfile","sanctionsScreened","kycLevel"]}
EOF
)
b0=$(blk); rest b_registerCpt_PersonKYC registerCpt "$(jq -n --arg w "$BANK" --argjson s "$KYC_SCHEMA" '{weId:$w,cptJsonSchema:$s}')" \
  "$(jq -n --arg i "$BANK" '{invokerWeId:$i}')"; b1=$(blk)
KYC_CPT=$(jq -r '.respBody.cptId' $OUT/b_registerCpt_PersonKYC.json)
[[ $(code b_registerCpt_PersonKYC) == 0 ]] && result b REST PASS "$(txs_between $b0 $b1)" "PersonKYC cptId=$KYC_CPT" || result b REST FAIL "" "$(jq -c . $OUT/b_registerCpt_PersonKYC.json)"

log "c register CPT AgentMandate (REST registerCpt, invoker=bank)"
MANDATE_SCHEMA=$(cat <<'EOF'
{"title":"AgentMandate","description":"Mandate from a principal to an AI agent wallet","type":"object",
 "properties":{
  "agent":{"type":"string","description":"WeID of the agent (credential subject)"},
  "principal":{"type":"string","description":"WeID of the principal (user)"},
  "wallet":{"type":"string","description":"CAIP-10 account, e.g. eip155:84532:0x..."},
  "scopes":{"type":"array","items":{"type":"string"}},
  "mandateHash":{"type":"string","pattern":"^0x[0-9a-fA-F]{64}$"},
  "riskProfile":{"type":"string"}},
 "required":["agent","principal","wallet","scopes","mandateHash","riskProfile"]}
EOF
)
b0=$(blk); rest c_registerCpt_AgentMandate registerCpt "$(jq -n --arg w "$BANK" --argjson s "$MANDATE_SCHEMA" '{weId:$w,cptJsonSchema:$s}')" \
  "$(jq -n --arg i "$BANK" '{invokerWeId:$i}')"; b1=$(blk)
MANDATE_CPT=$(jq -r '.respBody.cptId' $OUT/c_registerCpt_AgentMandate.json)
[[ $(code c_registerCpt_AgentMandate) == 0 ]] && result c REST PASS "$(txs_between $b0 $b1)" "AgentMandate cptId=$MANDATE_CPT" || result c REST FAIL "" "$(jq -c . $OUT/c_registerCpt_AgentMandate.json)"

log "e1 generate agent secp256k1 keypair locally (openssl)"
KEYF=$SPIKE/out/secrets/agent-$RUN.pem
openssl ecparam -name secp256k1 -genkey -noout -out "$KEYF" 2>/dev/null; chmod 600 "$KEYF"
AGENT_PUB_B64=$(openssl ec -in "$KEYF" -pubout -outform DER 2>/dev/null | tail -c 64 | base64 -w0)   # raw X||Y, no 04 prefix
AGENT_PRIV_HEX=$(openssl ec -in "$KEYF" -outform DER 2>/dev/null | head -c 39 | tail -c 32 | xxd -p -c 64)
python3 -I -c "import sys;print(int(sys.argv[1],16))" "$AGENT_PRIV_HEX" > "$SPIKE/out/secrets/agent-$RUN.dec"; chmod 600 "$SPIKE/out/secrets/agent-$RUN.dec"
unset AGENT_PRIV_HEX
echo "$AGENT_PUB_B64" > "$OUT/e1_agent_pubkey.b64"
result e1 local PASS "" "agent key in out/secrets/agent-$RUN.pem (test key, never leaves this machine)"

log "e2 create agent WeID from its public key (REST createWeIdWithPubKey, gas payer=admin)"
b0=$(blk); rest e2_createWeIdWithPubKey createWeIdWithPubKey "$(jq -n --arg p "$AGENT_PUB_B64" '{publicKeyECDSA:$p}')" \
  "$(jq -n --arg i "$ADMIN_INVOKER" '{invokerWeId:$i}')"; b1=$(blk)
AGENT=$(body e2_createWeIdWithPubKey)
[[ $(code e2_createWeIdWithPubKey) == 0 ]] && result e2 REST PASS "$(txs_between $b0 $b1)" "agent=$AGENT" || result e2 REST FAIL "" "$(jq -c . $OUT/e2_createWeIdWithPubKey.json)"

EXP_1Y=$(date -u -d '+1 year' +%Y-%m-%dT%H:%M:%SZ)
log "f1 bank issues PersonKYC credential to user (REST createCredentialPojo, invoker=bank)"
rest f1_createCredentialPojo_kyc createCredentialPojo "$(jq -n --argjson c "$KYC_CPT" --arg i "$BANK" --arg e "$EXP_1Y" --arg u "$USER" \
  '{cptId:$c, issuer:$i, expirationDate:$e, claim:{holder:$u, ageOver18:true, jurisdiction:"HK", riskProfile:"balanced", sanctionsScreened:"2026-10-01", kycLevel:2}}')" \
  "$(jq -n --arg i "$BANK" '{invokerWeId:$i}')"
jq '.respBody' $OUT/f1_createCredentialPojo_kyc.json > $OUT/credential_kyc_full.json
[[ $(code f1_createCredentialPojo_kyc) == 0 ]] && result f1 REST PASS "(off-chain, no tx)" "credential_kyc_full.json" || result f1 REST FAIL "" "$(jq -c . $OUT/f1_createCredentialPojo_kyc.json)"

log "f2 verify PersonKYC credential (REST verifyCredentialPojo)"
rest f2_verifyCredentialPojo_kyc verifyCredentialPojo "$(cat $OUT/credential_kyc_full.json)" '{}'
[[ $(body f2_verifyCredentialPojo_kyc) == true ]] && result f2 REST PASS "(read)" "verify=true" || result f2 REST FAIL "" "$(jq -c . $OUT/f2_verifyCredentialPojo_kyc.json)"

log "g1 user issues AgentMandate credential to agent (REST createCredentialPojo, invoker=user)"
MANDATE_HASH=0x$(printf 'mandate:%s:rebalance,pay:balanced' "$AGENT" | sha256sum | cut -d' ' -f1)
rest g1_createCredentialPojo_mandate createCredentialPojo "$(jq -n --argjson c "$MANDATE_CPT" --arg i "$USER" --arg e "$EXP_1Y" --arg a "$AGENT" --arg h "$MANDATE_HASH" \
  '{cptId:$c, issuer:$i, expirationDate:$e, claim:{agent:$a, principal:$i, wallet:"eip155:84532:0x0000000000000000000000000000000000001234", scopes:["rebalance","pay"], mandateHash:$h, riskProfile:"balanced"}}')" \
  "$(jq -n --arg i "$USER" '{invokerWeId:$i}')"
jq '.respBody' $OUT/g1_createCredentialPojo_mandate.json > $OUT/credential_mandate_user_signed.json
[[ $(code g1_createCredentialPojo_mandate) == 0 ]] && result g1 REST PASS "(off-chain, no tx)" "credential_mandate_user_signed.json" || result g1 REST FAIL "" "$(jq -c . $OUT/g1_createCredentialPojo_mandate.json)"

############################################ PHASE 2: Java SDK
cat > "$OUT/state.properties" <<EOF
run=$RUN
out=$OUT
bank=$BANK
user=$USER
agent=$AGENT
kycCpt=$KYC_CPT
mandateCpt=$MANDATE_CPT
agentKeyFile=$SPIKE/out/secrets/agent-$RUN.dec
restKeysDir=$REST_KEYS_DIR
adminKeyFile=$ADMIN_KEY_FILE
EOF
log "PHASE 2: Java SDK (weid-java-sdk 3.1.1-rc.2)"
"$SPIKE/java/run.sh" "$OUT/state.properties" 2>&1 | tee "$OUT/java_stdout.log" | grep -E '^(STEP|RESULT|ERR)' || true

############################################ PHASE 3: REST read-backs + negatives
log "a3b add bank to issuer type KYC_PROVIDER (REST addWeIdToWhitelist; type registered by Java in phase 2)"
b0=$(blk); rest a3_addWeIdToWhitelist addWeIdToWhitelist "$(jq -n --arg w "$BANK" '{weId:$w, whitelistName:"KYC_PROVIDER"}')" \
  "$(jq -n --arg i "$ADMIN_INVOKER" '{invokerWeId:$i}')"; b1=$(blk)
rest a3_isWeIdInWhitelist isWeIdInWhitelist "$(jq -n --arg w "$BANK" '{weId:$w, whitelistName:"KYC_PROVIDER"}')" '{}'
if [[ $(body a3_isWeIdInWhitelist) == true ]]; then result a3b REST PASS "$(txs_between $b0 $b1)" "isWeIdInWhitelist(KYC_PROVIDER)=true (add: $(jq -r .errorMessage $OUT/a3_addWeIdToWhitelist.json))"
else result a3b REST FAIL "" "$(jq -c . $OUT/a3_addWeIdToWhitelist.json) / $(jq -c . $OUT/a3_isWeIdInWhitelist.json)"; fi

log "e5 read agent DID document back (REST getWeIdDocument)"
rest e5_getWeIdDocument_agent getWeIdDocument "$(jq -n --arg w "$AGENT" '{weId:$w}')" '{}'
jq '.respBody' $OUT/e5_getWeIdDocument_agent.json > $OUT/agent_did_document_rest.json
NSVC=$(jq '[.respBody.weIdDocument.service[]? , (.respBody.weIdDocumentJson? // empty | fromjson? | .service[]?)] | map(select(.type=="AgentWallet" or .type=="MCP")) | length' $OUT/e5_getWeIdDocument_agent.json 2>/dev/null)
[[ $(code e5_getWeIdDocument_agent) == 0 && "${NSVC:-0}" -ge 2 ]] && result e5-rest REST PASS "(read)" "agent_did_document_rest.json has AgentWallet+MCP" || result e5-rest REST FAIL "" "services found=$NSVC"

for f in credential_kyc_selective credential_mandate_multisigned; do
  [[ -s $OUT/$f.json ]] || continue
  log "verify $f via REST verifyCredentialPojo"
  rest v_rest_$f verifyCredentialPojo "$(cat $OUT/$f.json)" '{}'
  [[ $(body v_rest_$f) == true ]] && result "rest-verify:$f" REST PASS "(read)" "REST accepts SDK-produced credential" || result "rest-verify:$f" REST FAIL "" "$(jq -c . $OUT/v_rest_$f.json)"
done

if [[ -s $OUT/evidence_hash.txt ]]; then
  log "h-rest getEvidence by hash (REST getEvidence)"
  rest h_rest_getEvidence getEvidence "$(jq -n --arg h "$(cat $OUT/evidence_hash.txt)" '{hashValue:$h}')" '{}'
  [[ $(code h_rest_getEvidence) == 0 ]] && result h-rest REST PASS "(read)" "evidence readable over REST" || result h-rest REST FAIL "" "$(jq -c . $OUT/h_rest_getEvidence.json)"
  log "i-rest verify the REVOKED KYC credential via REST (verify ignores revocation)"
  rest i_rest_verify_revoked verifyCredentialPojo "$(cat $OUT/credential_kyc_full.json)" '{}'
  result i-rest REST INFO "(read)" "verifyCredentialPojo on revoked credential returns $(body i_rest_verify_revoked) -> backend must check evidence revoked flag itself"
fi

log "j1-rest non-admin (user) tries to RECOGNIZE itself as Authority Issuer (REST recognizeAuthorityIssuer, invoker=user)"
b0=$(blk); rest j1_rest_recognize_by_user recognizeAuthorityIssuer "$(jq -n --arg w "$USER" '{weId:$w}')" "$(jq -n --arg i "$USER" '{invokerWeId:$i}')"; b1=$(blk)
rest j1_rest_queryAuthorityIssuer_user queryAuthorityIssuer "$(jq -n --arg w "$USER" '{weId:$w}')" '{}' >/dev/null
[[ $(body j1_rest_recognize_by_user) != true && $(jq -r '.respBody.recognized? // false' $OUT/j1_rest_queryAuthorityIssuer_user.json) != true ]] \
  && result j1-rest REST PASS "$(txs_between $b0 $b1)" "rejected as expected: $(jq -r '"\(.errorCode) \(.errorMessage)"' $OUT/j1_rest_recognize_by_user.json)" \
  || result j1-rest REST FAIL "$(txs_between $b0 $b1)" "NON-ADMIN RECOGNITION SUCCEEDED"

log "j2-rest tampered claim (kycLevel 2 -> 3) must fail verification (REST)"
jq '.claim.kycLevel=3' $OUT/credential_kyc_full.json > $OUT/credential_kyc_tampered.json
rest j2_rest_verify_tampered verifyCredentialPojo "$(cat $OUT/credential_kyc_tampered.json)" '{}'
[[ $(body j2_rest_verify_tampered) != true ]] && result j2-rest REST PASS "(read)" "rejected: $(jq -r '"\(.errorCode) \(.errorMessage)"' $OUT/j2_rest_verify_tampered.json)" || result j2-rest REST FAIL "" "tampered credential verified!"

if [[ -s $OUT/credential_expired.json ]]; then
  log "j3-rest expired credential must fail verification (REST)"
  rest j3_rest_verify_expired verifyCredentialPojo "$(cat $OUT/credential_expired.json)" '{}'
  [[ $(body j3_rest_verify_expired) != true ]] && result j3-rest REST PASS "(read)" "rejected: $(jq -r '"\(.errorCode) \(.errorMessage)"' $OUT/j3_rest_verify_expired.json)" || result j3-rest REST FAIL "" "expired credential verified!"
fi

log "k fetch logged tx hashes from the chain (web3 RPC eth_getTransactionByHash / eth_getTransactionReceipt)"
mapfile -t HASHES < <(cut -f4 "$RES" | tr ',' '\n' | grep -E '^0x[0-9a-f]{64}$' | sort -u)
ok=0; : > $OUT/k_tx_lookup.jsonl
for h in "${HASHES[@]}"; do
  t=$(curl -s -X POST "$WEB3" -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionByHash\",\"params\":[\"$h\"]}")
  r=$(curl -s -X POST "$WEB3" -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$h\"]}")
  jq -nc --argjson t "$t" --argjson r "$r" '{hash:$t.result.hash, block:$t.result.blockNumber, from:$t.result.from, to:$t.result.to, status:$r.result.status}' >> $OUT/k_tx_lookup.jsonl
  [[ $(echo "$t" | jq -r '.result.hash') == "$h" ]] && ((ok++))
done
result k web3-RPC "$([[ $ok -eq ${#HASHES[@]} && $ok -gt 0 ]] && echo PASS || echo FAIL)" "(read)" "$ok/${#HASHES[@]} logged tx hashes found on chain (k_tx_lookup.jsonl)"

log "SUMMARY ($RES)"
column -t -s $'\t' "$RES" | cut -c1-220
