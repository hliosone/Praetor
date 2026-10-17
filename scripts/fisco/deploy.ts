// make deploy-fisco ENV=local|live|sandbox: governance bootstrap (idempotent) then the consortium contracts, bound to
// the Base deployment of the same environment (domain name + MandateHook address). Writes
// infra/deployments/fisco-<env>.json. Keys come from .env (the environment's set, D1) and are never printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { bootstrapGovernance, deployConsortium } from '@praetor/fisco-client';

const root = fileURLToPath(new URL('../../', import.meta.url));
const envName = process.argv[2] ?? 'local';
const set = { local: 'LOCAL', live: 'LIVE', sandbox: 'SANDBOX' }[envName as 'local'] ?? 'LOCAL';
const baseFile = { local: 'fork', live: 'base-sepolia', sandbox: 'sandbox' }[envName as 'local'] ?? 'fork';
const rpc = process.env.FISCO_RPC_URL_HOST ?? 'http://10.88.1.10:8545';
const env = Object.fromEntries(readFileSync(`${root}.env`, 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const key = (role: string) => {
  const v = env[`${set}_${role}`];
  if (!v) throw new Error(`missing ${set}_${role}`);
  return v as Hex;
};
const addr = (role: string) => privateKeyToAccount(key(role)).address;

const base = JSON.parse(readFileSync(`${root}infra/deployments/${baseFile}.json`, 'utf8'));
const steps = await bootstrapGovernance(rpc, { admin: key('BANK_FISCO_KEY'), regulator: key('REGULATOR_FISCO_KEY'), operator: key('OPERATOR_FISCO_KEY') },
  [addr('DEPLOYER_KEY'), addr('WEID_ADMIN_KEY'), addr('WECROSS_FISCO_KEY')]);
console.log(`governance: ${steps.length ? steps.join(', ') : 'already bootstrapped'}`);
const d = await deployConsortium(rpc, {
  deployerKey: key('DEPLOYER_KEY'),
  members: [
    { fiscoAccount: addr('BANK_FISCO_KEY'), baseSigner: addr('BANK_BASE_SIGNER_KEY') },
    { fiscoAccount: addr('REGULATOR_FISCO_KEY'), baseSigner: addr('REGULATOR_BASE_SIGNER_KEY') },
    { fiscoAccount: addr('OPERATOR_FISCO_KEY'), baseSigner: addr('OPERATOR_BASE_SIGNER_KEY') },
  ],
  baseHook: base.mandateHook,
  domainName: base.domainName,
  router: addr('WECROSS_FISCO_KEY'),
  relayer: addr('RELAYER_FISCO_KEY'),
  usdc: base.usdc,
});
writeFileSync(`${root}infra/deployments/fisco-${envName}.json`, JSON.stringify({ env: envName, chainId: 20200, baseDeployment: baseFile, ...d }, null, 2) + '\n');
console.log(`fisco consortium deployed -> infra/deployments/fisco-${envName}.json`);
