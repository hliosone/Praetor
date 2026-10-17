// WeCross wiring after the router is up (M12, D42), idempotent:
// 1. BaseOutbox.setHub(WeCrossHub, FISCO WeCrossProxy), by the deployer (FISCO BFS paths /apps/WeCross*/latest);
// 2. the BaseOutbox linked in BFS as "outbox", so the router can call back payment.fisco.outbox.onDelivered;
// 3. the router's universal account (org1-admin) gets its two chain accounts: FISCO (WECROSS_FISCO_KEY, the identity
//    BaseOutbox.requestWeCross records) and Base (WECROSS_BASE_KEY, type EVM, Praetor's stub).
// Keys and passwords come from .env and are never printed.
import { constants, createHash, createPrivateKey, createPublicKey, publicEncrypt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BaseOutboxAbi, fiscoClients, sendFisco } from '@praetor/fisco-client';

const root = new URL('../../', import.meta.url).pathname;
const env = Object.fromEntries(readFileSync(`${root}.env`, 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const key = (name: string) => (env[name] ?? env[`LOCAL_${name}`]) as Hex;
const FISCO_RPC = process.env.FISCO_RPC_URL ?? 'http://10.88.1.10:8545';
const ROUTER = process.env.WECROSS_ROUTER_URL ?? 'http://10.88.0.50:8250';
const fisco = JSON.parse(readFileSync(`${root}infra/deployments/fisco-local.json`, 'utf8')) as { baseOutbox: Address };

const BFS = '0x000000000000000000000000000000000000100e' as Address;
const bfsAbi = parseAbi(['function readlink(string absolutePath) view returns (address)']);
const proxyAbi = parseAbi(['function linkBFS(string _path, string _addr, string _abi)']);
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

async function router(method: 'GET' | 'POST', path: string, data?: unknown, credential?: string) {
  const r = await fetch(`${ROUTER}${path}`, {
    method, headers: { 'content-type': 'application/json', accept: 'application/json', ...(credential ? { authorization: credential } : {}) },
    body: method === 'POST' ? JSON.stringify({ version: '1', data: data ?? null }) : undefined,
  });
  const j = (await r.json()) as { errorCode: number; message: string; data: any };
  if (j.errorCode !== 0) throw new Error(`router ${path}: ${j.errorCode} ${j.message}`);
  return j.data;
}

/** The SDK's login: salted SHA-256 password and the auth code token, RSA-encrypted with the router's public key. */
async function login(username: string, password: string): Promise<string> {
  const pub = (await router('GET', '/auth/pub')).pub as string;
  const code = (await router('GET', '/auth/authCode')).authCode;
  const body = JSON.stringify({ username, password: createHash('sha256').update(`1234567890~!#$%^&*()_+${password}`).digest('hex'), randomToken: code.randomToken });
  const der = Buffer.from(pub, 'base64');
  const enc = publicEncrypt({ key: createPublicKey({ key: der, format: 'der', type: 'spki' }), padding: constants.RSA_PKCS1_PADDING }, Buffer.from(body)).toString('base64');
  const r = await router('POST', '/auth/login', enc);
  return r.credential as string;
}

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
    await sendFisco(f.pub as PublicClient, f.wallet as WalletClient, { address: proxy, abi: proxyAbi, functionName: 'linkBFS', args: ['outbox', fisco.baseOutbox, abi] });
    console.log('BFS: outbox linked');
  }

  const credential = await login('org1-admin', env.WECROSS_ADMIN_PASSWORD!);
  const listed = JSON.stringify(await router('POST', '/auth/listAccount', {}, credential));
  for (const [type, k] of [['BCOS3_ECDSA_EVM', 'WECROSS_FISCO_KEY'], ['EVM', 'WECROSS_BASE_KEY']] as const) {
    const p = pems(key(k));
    if (listed.toLowerCase().includes(p.address.toLowerCase())) continue;
    await router('POST', '/auth/addChainAccount', { type, pubKey: p.pub, secKey: p.sec, ext: p.address, isDefault: true }, credential);
    console.log(`universal account: ${type} chain account ${p.address}`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
