#!/bin/bash
# Deploys the Base contracts for one environment (spec 03, 11): fork | base-sepolia | sandbox.
# Maps the environment's key set (LOCAL_ / LIVE_ / SANDBOX_, D1) to the unprefixed names the script reads,
# without ever printing a value. Writes infra/deployments/<env>.json.
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_NAME="${1:?usage: contracts.sh fork|base-sepolia|sandbox}"
case "$ENV_NAME" in
  fork) SET=LOCAL; DOMAIN=Praetor-local; RPC="${ANVIL_URL:-http://127.0.0.1:18545}" ;;
  base-sepolia) SET=LIVE; DOMAIN=Praetor; RPC="${BASE_LIVE_RPC_URL:-https://sepolia.base.org}" ;;
  sandbox) SET=SANDBOX; DOMAIN=Praetor-sandbox; RPC="${BASE_LIVE_RPC_URL:-https://sepolia.base.org}" ;;
  *) echo "unknown env $ENV_NAME" >&2; exit 2 ;;
esac

val() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
for role in DEPLOYER_KEY BANK_BASE_SIGNER_KEY REGULATOR_BASE_SIGNER_KEY OPERATOR_BASE_SIGNER_KEY ORACLE_FEEDER_KEY \
  DESK_OPERATOR_KEY PAYMASTER_SIGNER_KEY TREASURY_KEY; do
  v="$(val "${SET}_${role}")"
  [ -n "$v" ] || { echo "missing ${SET}_${role} in .env" >&2; exit 1; }
  export "$role=$v"
done
export DEPLOY_ENV="$ENV_NAME" DOMAIN_NAME="$DOMAIN"
export FORK_BLOCK="${FORK_BLOCK:-$(grep -E '^FORK_BLOCK=' infra/.env.example | cut -d= -f2)}"

if [ "$ENV_NAME" = fork ]; then
  deployer=$(cast wallet address --private-key "$DEPLOYER_KEY")
  # The fork funds its own keys (no faucet); 10 ETH covers deployment and the paymaster deposit.
  cast rpc --rpc-url "$RPC" anvil_setBalance "$deployer" 0x8AC7230489E80000 >/dev/null
  export PAYMASTER_DEPOSIT_WEI="${PAYMASTER_DEPOSIT_WEI:-1000000000000000000}"
else
  export PAYMASTER_DEPOSIT_WEI="${PAYMASTER_DEPOSIT_WEI:-20000000000000000}"
fi

cd contracts/base
forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --slow -q
echo "deployed $ENV_NAME -> infra/deployments/$ENV_NAME.json"
