// V2 Guomi probe: what the SHA3 opcode computes in SM mode, whether the web3 RPC answers, and whether it
// accepts an Ethereum (secp256k1) signed transaction. Compares with the non-SM chain.
// Usage: npx tsx spikes/V2-fisco/probe-sm.ts [smRpc=http://127.0.0.1:8555] [plainRpc=http://127.0.0.1:8545]
import { createPublicClient, defineChain, http, keccak256, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadEnv } from '../lib/env.js';

const [smRpc = 'http://127.0.0.1:8555', plainRpc = 'http://127.0.0.1:8545'] = process.argv.slice(2);
const SM3_ABC = '0x66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0';
// Init code that returns SHA3("abc"): PUSH3 "abc", PUSH1 232, SHL, PUSH1 0, MSTORE, PUSH1 3, PUSH1 0, SHA3,
// PUSH1 0, MSTORE, PUSH1 32, PUSH1 0, RETURN.
const HASH_ABC_INIT: Hex = '0x6261626360e81b60005260036000206000526020' + '6000f3' as Hex;

async function probe(rpc: string) {
  const chain = defineChain({ id: 20200, name: 'f', nativeCurrency: { name: 'x', symbol: 'x', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const c = createPublicClient({ chain, transport: http(rpc) });
  const out: Record<string, unknown> = {};
  out.chainId = await c.getChainId().catch((e) => `error: ${(e as Error).message.split('\n')[0]}`);
  out.block = await c.getBlockNumber().then(String).catch((e) => `error: ${(e as Error).message.split('\n')[0]}`);
  const h = await c.request({ method: 'eth_call', params: [{ data: HASH_ABC_INIT }, 'latest'] } as any).catch((e: Error) => `error: ${e.message.split('\n')[0]}`);
  out.sha3OfAbc = h;
  out.sha3Is = h === keccak256(toHex('abc')) ? 'keccak256' : h === SM3_ABC ? 'SM3' : 'unknown';
  // An Ethereum-signed legacy deploy of the same init code.
  const env = loadEnv();
  const a = privateKeyToAccount(env.LOCAL_DEPLOYER_KEY as Hex);
  const nonce = await c.getTransactionCount({ address: a.address }).catch(() => 0);
  const raw = await a.signTransaction({ type: 'legacy', chainId: 20200, nonce, gas: 1_000_000n, gasPrice: 0n, data: HASH_ABC_INIT });
  out.ethSignedTx = await c.request({ method: 'eth_sendRawTransaction', params: [raw] } as any)
    .then(async (hash: any) => {
      const r = await c.waitForTransactionReceipt({ hash, timeout: 20_000 }).catch((e: Error) => ({ status: `no receipt: ${e.message.split('\n')[0]}` }) as any);
      return { hash, status: r.status, from: r.from, expectedFrom: a.address };
    })
    .catch((e: Error) => `rejected: ${e.message.split('\n').slice(0, 2).join(' ')}`);
  return out;
}

const result = { sm: await probe(smRpc), plain: await probe(plainRpc) };
console.log(JSON.stringify(result, null, 2));
