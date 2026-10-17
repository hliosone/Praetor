// WeCross wiring after the router is up (M12, D42), idempotent:
// 1. BaseOutbox.setHub(WeCrossHub, FISCO WeCrossProxy), by the deployer (FISCO BFS paths /apps/WeCross*/latest);
// 2. the BaseOutbox linked in BFS as /apps/outbox/latest, so the router can call back payment.fisco.outbox.onDelivered;
// 3. the router's universal account (org1-admin) gets its two chain accounts: FISCO (WECROSS_FISCO_KEY, the identity
//    BaseOutbox.requestWeCross records) and Base (WECROSS_BASE_KEY, type EVM, Praetor's stub).
// Keys and passwords come from .env and are never printed.
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BaseOutboxAbi, fiscoClients, sendFisco } from '@praetor/fisco-client';
import { login, router } from './router.js';

const root = new URL('../../', import.meta.url).pathname;
const env = Object.fromEntries(readFileSync(`${root}.env`, 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
// The mode's key set for the Base account; the FISCO side keeps the FISCO chain's own set (D75: FISCO_KEYSET).
const live = process.env.CHAIN_MODE === 'live';
const set = live ? 'LIVE' : 'LOCAL';
const fiscoSet = process.env.FISCO_KEYSET ?? set;
const FISCO_SIDE = new Set(['WECROSS_FISCO_KEY', 'DEPLOYER_KEY']);
const key = (name: string) => (env[name] ?? env[`${FISCO_SIDE.has(name) ? fiscoSet : set}_${name}`]) as Hex;
const FISCO_RPC = process.env.FISCO_RPC_URL ?? 'http://10.88.1.10:8545';
const fisco = JSON.parse(readFileSync(`${root}infra/deployments/fisco-${live ? 'live' : 'local'}.json`, 'utf8')) as { baseOutbox: Address };

const BFS = '0x000000000000000000000000000000000000100e' as Address;
const bfsAbi = parseAbi(['function readlink(string absolutePath) view returns (address)']);
// FISCO refuses a BFS link made by a contract here: the WeCross account links directly, as the stub's deploy tool does.
const bfsLinkAbi = parseAbi(['function link(string name, string version, string _address, string _abi) returns (int32)']);
const outboxAbi = parseAbi(['function hub() view returns (address)', 'function hubProxy() view returns (address)']);
const ZERO = '0x0000000000000000000000000000000000000000';

/** PKCS#8 / SPKI PEMs of a secp256k1 hex key (the account manager stores keys as PEM). */
function pems(hex: Hex) {
  const a = privateKeyToAccount(hex);
  const b64u = (h: string) => Buffer.from(h, 'hex').toString('base64url');
  const jwk = { kty: 'EC', crv: 'secp256k1', d: b64u(hex.slice(2)), x: b64u(a.publicKey.slice(4, 68)), y: b64u(a.publicKey.slice(68)) };
  const priv = createPrivateKey({ key: jwk, format: 'jwk' });
  return { address: a.address, sec: priv.export({ type: 'pkcs8', format: 'pem' }) as string, pub: createPublicKey(priv).export({ type: 'spki', format: 'pem' }) as string };
}

let restartRouter = false;

async function main() {
  const f = fiscoClients(FISCO_RPC, key('WECROSS_FISCO_KEY'));
  const proxy = (await f.pub.readContract({ address: BFS, abi: bfsAbi, functionName: 'readlink', args: ['/apps/WeCrossProxy/latest'] })) as Address;
  const hub = (await f.pub.readContract({ address: BFS, abi: bfsAbi, functionName: 'readlink', args: ['/apps/WeCrossHub/latest'] })) as Address;
  if (proxy === ZERO || hub === ZERO) throw new Error('WeCrossProxy / WeCrossHub not deployed on FISCO (run the wecross-setup job first)');
  console.log(`FISCO WeCrossProxy ${proxy}, WeCrossHub ${hub}`);

  const d = fiscoClients(FISCO_RPC, key('DEPLOYER_KEY'));
  if (((await d.pub.readContract({ address: fisco.baseOutbox, abi: outboxAbi, functionName: 'hub' })) as Address) === ZERO) {
    await sendFisco(d.pub as PublicClient, d.wallet as WalletClient, { address: fisco.baseOutbox, abi: BaseOutboxAbi as never, functionName: 'setHub', args: [hub, proxy] });
    console.log('BaseOutbox: hub set');
  }
  const linked = (await f.pub.readContract({ address: BFS, abi: bfsAbi, functionName: 'readlink', args: ['/apps/outbox/latest'] })) as Address;
  if (linked.toLowerCase() !== fisco.baseOutbox.toLowerCase()) {
    const abi = JSON.stringify(BaseOutboxAbi.filter((x) => x.type === 'function' && x.name === 'onDelivered'));
    await sendFisco(f.pub as PublicClient, f.wallet as WalletClient, { address: BFS, abi: bfsLinkAbi, functionName: 'link', args: ['outbox', 'latest', fisco.baseOutbox.toLowerCase(), abi] });
    console.log('BFS: outbox linked');
  }

  const credential = await login('org1-admin', env.WECROSS_ADMIN_PASSWORD!);
  const ua = (await router('POST', '/auth/listAccount', {}, credential)) as { chainAccounts: { keyID: number; type: string; ext: string }[] };
  for (const [type, k] of [['BCOS3_ECDSA_EVM', 'WECROSS_FISCO_KEY'], ['EVM', 'WECROSS_BASE_KEY']] as const) {
    const p = pems(key(k));
    // The BCOS3 stub compares ext with the lowercase address it derives from the key: store it lowercase.
    const ext = p.address.toLowerCase();
    const have = ua.chainAccounts.find((a) => a.type === type && a.ext.toLowerCase() === ext);
    if (have?.ext === ext) continue;
    if (have) await router('POST', '/auth/removeChainAccount', { type, keyID: have.keyID }, credential);
    await router('POST', '/auth/addChainAccount', { type, pubKey: p.pub, secKey: p.sec, ext, isDefault: true }, credential);
    console.log(`universal account: ${type} chain account ${ext}`);
    restartRouter = true;
  }
  // The router reads its account at login: after a change it must restart (scripts/wecross/up.sh does it).
  if (restartRouter) writeFileSync(`${root}.run/wecross-restart-router`, '');
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
