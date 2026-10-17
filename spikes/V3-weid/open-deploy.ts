// Opens FISCO deploy rights for one account through the committee (bank proposes, regulator votes):
// the path WeIdentity's own deployer needs once the deploy whitelist is on.
// Usage: npx tsx spikes/V3-weid/open-deploy.ts <address | path-to-decimal-private-key-file> [rpc]
import { existsSync, readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadEnv } from '../lib/env.js';

const [target, rpc = 'http://127.0.0.1:8545'] = process.argv.slice(2);
if (!target) throw new Error('usage: open-deploy.ts <address|keyfile> [rpc]');
// WeIdentity Build-Tools writes its admin key as a decimal integer; only the derived address is used here.
const account: Address = existsSync(target)
  ? privateKeyToAccount(toHex(BigInt(readFileSync(target, 'utf8').trim()), { size: 32 }) as Hex).address
  : (target as Address);

const chain = defineChain({ id: 20200, name: 'f', nativeCurrency: { name: 'x', symbol: 'x', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const pub = createPublicClient({ chain, transport: http(rpc), cacheTime: 0 });
const env = loadEnv();
const abi = parseAbi([
  'function createModifyDeployAuthProposal(address account, bool openFlag, uint256 blockNumberInterval) returns (uint256)',
  'function voteProposal(uint256 proposalId, bool agree)',
]);
const authAbi = parseAbi(['function hasDeployAuth(address) view returns (bool)']);
const COMMITTEE: Address = '0x0000000000000000000000000000000000010001';
const tx = { type: 'legacy' as const, gasPrice: 0n, gas: 5_000_000n, chain };

const bank = privateKeyToAccount(env.LOCAL_BANK_FISCO_KEY as Hex);
const regulator = privateKeyToAccount(env.LOCAL_REGULATOR_FISCO_KEY as Hex);
const { result: id } = await pub.simulateContract({ account: bank, address: COMMITTEE, abi, functionName: 'createModifyDeployAuthProposal', args: [account, true, 1000n], ...tx });
await pub.waitForTransactionReceipt({ hash: await createWalletClient({ account: bank, chain, transport: http(rpc) }).writeContract({ address: COMMITTEE, abi, functionName: 'createModifyDeployAuthProposal', args: [account, true, 1000n], ...tx }) });
await pub.waitForTransactionReceipt({ hash: await createWalletClient({ account: regulator, chain, transport: http(rpc) }).writeContract({ address: COMMITTEE, abi, functionName: 'voteProposal', args: [id, true], ...tx }) });
const ok = await pub.readContract({ address: '0x0000000000000000000000000000000000001005', abi: authAbi, functionName: 'hasDeployAuth', args: [account] });
console.log(JSON.stringify({ account, proposalId: String(id), hasDeployAuth: ok }));
