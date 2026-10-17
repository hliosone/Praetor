// V2 probe against the Dockerised 4-node chain (non-SM): EVM facts, governance bootstrap, deploy ACL,
// eth_getLogs range limit. Prints a JSON report; no secret is printed.
// Usage: npx tsx spikes/V2-fisco/probe.ts [rpc=http://127.0.0.1:8545]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient, createWalletClient, defineChain, http, keccak256, toHex, parseAbi, parseAbiItem,
  type Hex, type Address,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey, sign } from 'viem/accounts';
import { loadEnv } from '../lib/env.js';

const rpc = process.argv[2] ?? 'http://127.0.0.1:8545';
const fisco = defineChain({ id: 20200, name: 'fisco', nativeCurrency: { name: 'x', symbol: 'x', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const pub = createPublicClient({ chain: fisco, transport: http(rpc), cacheTime: 0 });
const env = loadEnv();
const acct = (k: string) => privateKeyToAccount(env[k] as Hex);
const admin = acct('LOCAL_BANK_FISCO_KEY');
const regulator = acct('LOCAL_REGULATOR_FISCO_KEY');
const operator = acct('LOCAL_OPERATOR_FISCO_KEY');
const deployer = acct('LOCAL_DEPLOYER_KEY');
const stranger = privateKeyToAccount(generatePrivateKey());
const wallet = (a: ReturnType<typeof privateKeyToAccount>) => createWalletClient({ account: a, chain: fisco, transport: http(rpc) });

const artifact = JSON.parse(readFileSync(fileURLToPath(new URL('./contracts/out/Probe.sol/Probe.json', import.meta.url)), 'utf8'));
const probeAbi = artifact.abi;
const COMMITTEE: Address = '0x0000000000000000000000000000000000010001';
const CONTRACT_AUTH: Address = '0x0000000000000000000000000000000000001005';
const committeeAbi = parseAbi([
  'function createUpdateGovernorProposal(address account, uint32 weight, uint256 blockNumberInterval) returns (uint256)',
  'function createSetRateProposal(uint8 participatesRate, uint8 winRate, uint256 blockNumberInterval) returns (uint256)',
  'function createSetDeployAuthTypeProposal(uint8 deployAuthType, uint256 blockNumberInterval) returns (uint256)',
  'function createModifyDeployAuthProposal(address account, bool openFlag, uint256 blockNumberInterval) returns (uint256)',
  'function voteProposal(uint256 proposalId, bool agree)',
  'function isGovernor(address account) view returns (bool)',
  'event execResult(int256)',
]);
const authAbi = parseAbi(['function deployType() view returns (uint256)', 'function hasDeployAuth(address) view returns (bool)']);

// FISCO quirk: legacy transactions with gasPrice 0.
const txOpts = { type: 'legacy' as const, gasPrice: 0n };
const report: Record<string, unknown> = {};

async function send(a: ReturnType<typeof privateKeyToAccount>, address: Address, abi: any, functionName: string, args: unknown[]) {
  const { result } = await pub.simulateContract({ account: a, address, abi, functionName, args, ...txOpts }).catch(() => ({ result: undefined }));
  const hash = await wallet(a).writeContract({ address, abi, functionName, args, ...txOpts, gas: 5_000_000n, chain: fisco });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return { hash, status: receipt.status, block: receipt.blockNumber, result, logs: receipt.logs.length };
}

async function deploy(a: ReturnType<typeof privateKeyToAccount>) {
  try {
    const hash = await wallet(a).deployContract({ abi: probeAbi, bytecode: artifact.bytecode.object, ...txOpts, gas: 5_000_000n, chain: fisco });
    const r = await pub.waitForTransactionReceipt({ hash });
    return { ok: r.status === 'success' && !!r.contractAddress, address: r.contractAddress, status: r.status };
  } catch (e) {
    return { ok: false, error: String((e as Error).message).split('\n')[0] };
  }
}

async function main() {
  report.chainId = await pub.getChainId();
  report.blockStart = Number(await pub.getBlockNumber());
  report.peerCount = await pub.request({ method: 'net_peerCount' as any }).catch((e: Error) => `n/a: ${e.message.split('\n')[0]}`);

  // 1. EVM facts (deploy open by default even in auth mode?)
  const d1 = await deploy(deployer);
  report.deployBeforeAcl = d1;
  const probe = d1.address as Address;
  report.keccakMatchesViem = (await pub.readContract({ address: probe, abi: probeAbi, functionName: 'k' })) === keccak256(toHex('abc'));
  const ts = (await pub.readContract({ address: probe, abi: probeAbi, functionName: 'ts' })) as bigint;
  const head = await pub.getBlock();
  report.timestamp = { evm: ts.toString(), rpcHeader: head.timestamp.toString(), evmLooksMs: ts > 10_000_000_000n };
  report.evmChainId = String(await pub.readContract({ address: probe, abi: probeAbi, functionName: 'cid' }));
  const digest = keccak256(toHex('praetor'));
  const sig = await sign({ hash: digest, privateKey: env.LOCAL_REGULATOR_BASE_SIGNER_KEY as Hex });
  const recovered = await pub.readContract({ address: probe, abi: probeAbi, functionName: 'rec', args: [digest, Number(sig.v), sig.r, sig.s] });
  report.ecrecoverMatches = recovered === privateKeyToAccount(env.LOCAL_REGULATOR_BASE_SIGNER_KEY as Hex).address;

  // 2. Governance bootstrap: admin alone has 100% of the weight, so its own proposals pass on creation.
  report.adminIsGovernor = await pub.readContract({ address: COMMITTEE, abi: committeeAbi, functionName: 'isGovernor', args: [admin.address] });
  report.addRegulator = await send(admin, COMMITTEE, committeeAbi, 'createUpdateGovernorProposal', [regulator.address, 1, 1000n]);
  report.addOperator = await send(admin, COMMITTEE, committeeAbi, 'createUpdateGovernorProposal', [operator.address, 1, 1000n]);
  report.governors = {
    regulator: await pub.readContract({ address: COMMITTEE, abi: committeeAbi, functionName: 'isGovernor', args: [regulator.address] }),
    operator: await pub.readContract({ address: COMMITTEE, abi: committeeAbi, functionName: 'isGovernor', args: [operator.address] }),
  };
  // With 3 governors of weight 1, a proposal needs a second vote; rates 51/51 per spec 04.
  const rate = await send(admin, COMMITTEE, committeeAbi, 'createSetRateProposal', [51, 51, 1000n]);
  report.setRate = { create: rate, vote: await send(regulator, COMMITTEE, committeeAbi, 'voteProposal', [rate.result, true]) };

  // 3. Deploy ACL: whitelist, then open the deployer only.
  const t = await send(admin, COMMITTEE, committeeAbi, 'createSetDeployAuthTypeProposal', [1, 1000n]);
  report.setWhitelist = { create: t, vote: await send(regulator, COMMITTEE, committeeAbi, 'voteProposal', [t.result, true]) };
  const o = await send(admin, COMMITTEE, committeeAbi, 'createModifyDeployAuthProposal', [deployer.address, true, 1000n]);
  report.openDeployer = { create: o, vote: await send(regulator, COMMITTEE, committeeAbi, 'voteProposal', [o.result, true]) };
  report.deployType = String(await pub.readContract({ address: CONTRACT_AUTH, abi: authAbi, functionName: 'deployType' }));
  report.hasDeployAuth = {
    deployer: await pub.readContract({ address: CONTRACT_AUTH, abi: authAbi, functionName: 'hasDeployAuth', args: [deployer.address] }),
    stranger: await pub.readContract({ address: CONTRACT_AUTH, abi: authAbi, functionName: 'hasDeployAuth', args: [stranger.address] }),
    admin: await pub.readContract({ address: CONTRACT_AUTH, abi: authAbi, functionName: 'hasDeployAuth', args: [admin.address] }),
  };
  report.deployAfterAcl = { deployer: await deploy(deployer), stranger: await deploy(stranger) };

  // 4. eth_getLogs range: write 12 events in 12 blocks, then query ranges of 10 and 11 blocks.
  const blocks: bigint[] = [];
  for (let i = 0; i < 12; i++) blocks.push((await send(deployer, probe, probeAbi, 'store', [BigInt(i)])).block);
  const ev = parseAbiItem('event Stored(uint256 indexed v, address indexed by)');
  const from = blocks[0]!;
  const logs = async (span: bigint) => (await pub.getLogs({ address: probe, event: ev, fromBlock: from, toBlock: from + span - 1n })).length;
  report.getLogs = { blocksSpanned: Number(blocks.at(-1)! - from + 1n), span10: await logs(10n), span11: await logs(11n) };
  report.getLogsNoTopics = await pub.request({ method: 'eth_getLogs', params: [{ address: probe, fromBlock: toHex(from), toBlock: toHex(from + 2n) }] })
    .then((r: any) => `${r.length} logs`).catch((e: Error) => `error: ${e.message.split('\n')[0]}`);
  report.blockEnd = Number(await pub.getBlockNumber());
  console.log(JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
}

main().catch((e) => { console.error(e); console.log(JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)); process.exit(1); });
