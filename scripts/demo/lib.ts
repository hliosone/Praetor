// Seed and e2e helpers on the local stack (spec 10, M5): drive the member services, the bundler and the relayer
// like the api will, with software passkeys standing in for staff and owner devices. Reads .env without printing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData, http, keccak256, pad, parseAbi, toHex, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { MandateHookAbi, PriceOracleAbi, PraetorTokenAbi, baseNow, loadDeployments, type Deployment } from '@praetor/chain';
import {
  digest, encodePolicy, merchantKey, merchantRef, ownerActionPayload, passkeyAuth, praetorDomain, softPasskey, OwnerActionKind as K,
  type Policy, type SoftPasskey,
} from '@praetor/protocol';
import { signCaller } from '@praetor/protocol/caller-auth';
import { encodeExecute, fromJson, prepareAccount, toJson, ENTRY_POINT, type Call } from '@praetor/userop';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export type Role = 'bank' | 'regulator' | 'operator';

export type Stack = {
  env: Record<string, string>;
  base: Deployment;
  baseRpc: string;
  bundler: string;
  members: Record<Role, string>;
  signer: string;
  attester: string;
  mcp: string;
  agentRunner: string;
  fakeLlm: string;
  rpId: string;
  origin: string;
};

export function stack(over: Partial<Stack> = {}): Stack {
  const env = Object.fromEntries(readFileSync(`${root}.env`, 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return {
    env,
    base: loadDeployments(`${root}infra/deployments/fork.json`),
    baseRpc: process.env.ANVIL_URL ?? 'http://127.0.0.1:18545',
    bundler: process.env.BUNDLER_URL ?? 'http://10.88.0.10:3010',
    members: { bank: 'http://10.88.0.21:3020', regulator: 'http://10.88.0.22:3020', operator: 'http://10.88.0.23:3020' },
    signer: process.env.AGENT_SIGNER_URL_HOST ?? 'http://10.88.0.50:3050',
    attester: process.env.SOTER_ATTESTER_URL_HOST ?? 'http://10.88.0.51:3060',
    mcp: process.env.MCP_URL_HOST ?? 'http://10.88.0.60:3080',
    agentRunner: process.env.AGENT_RUNNER_URL_HOST ?? 'http://10.90.0.10:3100',
    fakeLlm: process.env.FAKE_LLM_URL_HOST ?? 'http://10.90.0.20:3090',
    rpId: 'praetor.localhost',
    origin: 'https://praetor.localhost',
    ...over,
  };
}

export const pub = (s: Stack) => createPublicClient({ chain: baseSepolia, transport: http(s.baseRpc) });
export const localKey = (s: Stack, role: string) => s.env[`LOCAL_${role}`] as Hex;
export const addressOf = (k: Hex) => privateKeyToAccount(k).address;
export const labelAddress = (label: string) => privateKeyToAccount(keccak256(toHex(`praetor-demo:${label}`))).address;

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));

export async function http2(url: string, token: string, body?: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : json(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const member = (s: Stack, role: Role, path: string, body?: unknown) => http2(`${s.members[role]}${path}`, s.env.INTERNAL_TOKEN_MEMBERS!, body);
export const bundler = (s: Stack, path: string, body?: unknown) => http2(`${s.bundler}${path}`, s.env.INTERNAL_TOKEN_BUNDLER!, body);

/** soter-attester (TEE) as the api, its only caller. */
export async function attesterCall(s: Stack, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const method = body === undefined ? 'GET' : 'POST';
  const raw = body === undefined ? '' : json(body);
  const r = await fetch(`${s.attester}${path}`, { method, body: raw || undefined, headers: { 'content-type': 'application/json', ...signCaller('api', s.env.ATTESTER_HMAC_API!, method, path, Buffer.from(raw)) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/** The SOTER attester TEE, activated on the hook: the bank verifies its quote, then co-signs the activation. */
export async function activateSoterAttester(s: Stack): Promise<Address> {
  const { attester } = await ok(attesterCall(s, '/v1/info'), 'attester info');
  const [, active] = await read<readonly [Hex, boolean]>(s, 'attesterOf', [attester]);
  if (active) return attester;
  const { nonce } = await ok(member(s, 'bank', '/attesters/nonce', { attester }), 'attester nonce');
  const { quote } = await ok(attesterCall(s, '/v1/attest', { nonce }), 'attester quote');
  const { measurement } = await ok(member(s, 'bank', '/attesters/verify', { attester, nonce, quote }), 'attester quote check');
  // A board keeps one open proposal per key until its deadline: join a matching one left open (never signed).
  const fisco = JSON.parse(readFileSync(`${root}infra/deployments/fisco-local.json`, 'utf8')) as { attesterRegistry: Address };
  const fiscoPub = createPublicClient({ transport: http(process.env.FISCO_RPC_URL_HOST ?? 'http://10.88.1.10:8545') });
  const key = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }], [7, pad(attester as Hex)]));
  const openId = await fiscoPub.readContract({ address: fisco.attesterRegistry, abi: parseAbi(['function openProposalOf(bytes32) view returns (uint256)']), functionName: 'openProposalOf', args: [key] });
  const pending = openId ? await ok(member(s, 'bank', `/proposals/attesters/${openId}`), 'open attester proposal') : null;
  const m = pending?.message as { measurement?: string; active?: boolean } | undefined;
  if (pending && pending.status === 1 && m?.active === true && m.measurement?.toLowerCase() === String(measurement).toLowerCase()) {
    await ok(member(s, 'bank', `/proposals/attesters/${openId}/sign`, { assertion: staffAssertion(s, 'bank', pending.digest) }), 'sign open attester proposal');
  } else {
    await openAndSign(s, 'bank', '/attesters', { attester, measurement, active: true }, ['bank']);
  }
  await waitFor('attester active on Base', async () => (await read<readonly [Hex, boolean]>(s, 'attesterOf', [attester]))[1]);
  return attester;
}

/** agent-signer (TEE) as one of its callers: api (address, attest) or mcp (sign-userop). */
export async function signer(s: Stack, caller: 'api' | 'mcp' | 'bank', path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const method = body === undefined ? 'GET' : 'POST';
  const raw = body === undefined ? '' : json(body);
  const secret = s.env[`SIGNER_HMAC_${caller.toUpperCase()}`]!;
  const r = await fetch(`${s.signer}${path}`, { method, body: raw || undefined, headers: { 'content-type': 'application/json', ...signCaller(caller, secret, method, path, Buffer.from(raw)) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function ok(p: Promise<{ status: number; body: any }>, what: string) {
  const r = await p;
  if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

// ---------------------------------------------------------------- staff passkeys (stand-ins for the consoles)

export const devStaff = (s: Stack, role: Role) => softPasskey(`praetor-dev-staff-${role}`, s.rpId, s.origin);

/** Enrols the dev staff passkey with the one-time token; a later run finds the token used and keeps going. */
export async function ensureStaff(s: Stack, role: Role): Promise<void> {
  const pk = devStaff(s, role);
  const r = await member(s, role, '/staff/enrol', { token: s.env[`STAFF_ENROL_TOKEN_${role.toUpperCase()}`], credentialId: pk.credIdHash, x: toHex(pk.x), y: toHex(pk.y), label: `dev-${role}` });
  if (r.status !== 204 && r.status !== 403) throw new Error(`staff enrol ${role}: ${r.status}`);
}

export function staffAssertion(s: Stack, role: Role, d: Hex) {
  const pk = devStaff(s, role);
  const a = pk.sign(d);
  return { credentialId: pk.credIdHash, authenticatorData: a.authenticatorData, clientDataJSON: a.clientDataJSON, r: toHex(a.r, { size: 32 }), s: toHex(a.s, { size: 32 }) };
}

/** Opens a proposal on `opener`'s service and signs it on each signer's service with its staff passkey. */
export async function openAndSign(s: Stack, opener: Role, path: string, body: unknown, signers: Role[]) {
  const o = await ok(member(s, opener, path, body), `open ${path}`);
  let ready = false;
  for (const role of signers) {
    const p = await ok(member(s, role, `/proposals/${o.board}/${o.proposalId}`), 'read proposal');
    const r = await ok(member(s, role, `/proposals/${o.board}/${o.proposalId}/sign`, { assertion: staffAssertion(s, role, p.digest) }), `sign by ${role}`);
    ready = r.ready;
  }
  return { board: o.board as string, proposalId: o.proposalId as string, digest: o.digest as Hex, ready };
}

export async function waitFor<T>(what: string, fn: () => Promise<T | undefined | false>, timeoutMs = 90_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v as T;
    if (Date.now() > until) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

const read = <T>(s: Stack, functionName: string, args: readonly unknown[]) =>
  pub(s).readContract({ address: s.base.mandateHook, abi: MandateHookAbi, functionName: functionName as never, args: args as never }) as Promise<T>;

// ---------------------------------------------------------------- consortium bootstrap

export const PARTNER = (s: Stack) => addressOf(localKey(s, 'PAYOUT_PARTNER_KEY'));

/** Caps, assets, partner, CN payouts blocked, a heartbeat: through FISCO proposals, delivered by the relayer. */
export async function bootstrapConsortium(s: Stack): Promise<void> {
  for (const r of ['bank', 'regulator', 'operator'] as Role[]) await ensureStaff(s, r);
  const [perTx] = await read<readonly [bigint, bigint, bigint]>(s, 'capsOf', [2]);
  if (perTx === 0n) {
    await openAndSign(s, 'bank', '/caps', { riskProfile: 2, perTxCap: '5000000000', dailyCap: '10000000000', monthlyCap: '50000000000' }, ['bank']);
    await openAndSign(s, 'bank', '/caps', { riskProfile: 1, perTxCap: '2000000000', dailyCap: '4000000000', monthlyCap: '20000000000' }, ['bank']);
    await openAndSign(s, 'bank', '/caps', { riskProfile: 3, perTxCap: '10000000000', dailyCap: '20000000000', monthlyCap: '100000000000' }, ['bank']);
  }
  const assets: [Address, number, number][] = [[s.base.usdc, 0, 10_000], [s.base.txau, 0, 3500], [s.base.txag, 0, 1500], [s.base.treasuryDesk, 1, 0], [PARTNER(s), 2, 0]];
  for (const [asset, kind, maxW] of assets) {
    const [, status] = await read<readonly [number, number, number, bigint]>(s, 'assetOf', [asset]);
    if (status !== 1) await openAndSign(s, 'bank', '/assets', { asset, kind, status: 1, maxWeightBps: maxW }, ['bank']);
  }
  if (!(await read<boolean>(s, 'isPayoutBlocked', ['0x434e']))) await openAndSign(s, 'regulator', '/jurisdictions', { jurisdiction: 'CN', blocked: true }, ['regulator']);
  await ok(member(s, 'operator', '/heartbeat/beat', {}), 'heartbeat');
  await waitFor('consortium bootstrap on Base', async () => {
    const [p] = await read<readonly [bigint, bigint, bigint]>(s, 'capsOf', [3]);
    const [, partner] = await read<readonly [number, number, number, bigint]>(s, 'assetOf', [PARTNER(s)]);
    const blocked = await read<boolean>(s, 'isPayoutBlocked', ['0x434e']);
    const [,,, hb] = await read<readonly [number, number, number, bigint]>(s, 'statusOf', [PARTNER(s)]);
    return p > 0n && partner === 1 && blocked && hb > (await baseNow(pub(s)));
  }, 180_000);
}

/** Seeded DEMO prices (Q27) until the oracle-feeder runs with a Pyth key. */
export async function setDemoPrices(s: Stack, xau = 265_000_000_000n, xag = 3_112_000_000n): Promise<void> {
  const w = createWalletClient({ chain: baseSepolia, transport: http(s.baseRpc), account: privateKeyToAccount(localKey(s, 'ORACLE_FEEDER_KEY')) });
  const t = await baseNow(pub(s));
  for (const [token, price] of [[s.base.txau, xau], [s.base.txag, xag]] as const) {
    const h = await w.writeContract({ address: s.base.priceOracle, abi: PriceOracleAbi, functionName: 'setPrice', args: [token, price, t, 1], chain: baseSepolia });
    await pub(s).waitForTransactionReceipt({ hash: h });
  }
}

/** A demo price shock (source DEMO): the feeder holds it for DEMO_HOLD_S. The oracle refuses moves over 25%. */
export async function shockPrice(s: Stack, asset: 'XAU' | 'XAG', pct: number): Promise<bigint> {
  const token = asset === 'XAU' ? s.base.txau : s.base.txag;
  const [price] = (await pub(s).readContract({ address: s.base.priceOracle, abi: PriceOracleAbi, functionName: 'getPrice', args: [token] })) as readonly [bigint, bigint];
  const next = (price * BigInt(Math.round((100 + pct) * 100))) / 10_000n;
  const w = createWalletClient({ chain: baseSepolia, transport: http(s.baseRpc), account: privateKeyToAccount(localKey(s, 'ORACLE_FEEDER_KEY')) });
  const h = await w.writeContract({ address: s.base.priceOracle, abi: PriceOracleAbi, functionName: 'setPrice', args: [token, next, await baseNow(pub(s)), 1], chain: baseSepolia });
  await pub(s).waitForTransactionReceipt({ hash: h });
  return next;
}

// ---------------------------------------------------------------- account, mandate, funds

/** The agent key lives in agent-signer (TEE): only its address is known here. */
export type Account = { address: Address; owner: SoftPasskey; agent: Address };

export async function createAccount(s: Stack, label: string): Promise<Account> {
  const owner = softPasskey(`praetor-demo-owner-${label}`, s.rpId, s.origin);
  const prep = await prepareAccount(pub(s) as never, { ...s.base, credIdHash: owner.credIdHash, x: owner.x, y: owner.y }, BigInt(keccak256(toHex(`salt:${label}`))) % 2n ** 64n);
  const code = await pub(s).getCode({ address: prep.address });
  if (!code || code === '0x') {
    await ok(bundler(s, '/accounts', { address: prep.address }), 'register account');
    const p = await ok(bundler(s, '/userop/prepare', { sender: prep.address, callData: prep.callData, validator: 'passkey', factory: prep.factory, factoryData: prep.factoryData }), 'prepare first op');
    const { encodePasskeySignature } = await import('@praetor/protocol');
    const sent = await ok(bundler(s, '/userop/send', { userOp: { ...p.userOp, signature: encodePasskeySignature(owner.credIdHash, owner.sign(p.userOpHash)) } }), 'send first op');
    if (!sent.success) throw new Error('account creation failed');
  }
  const agent = (await ok(signer(s, 'api', `/v1/agents/${prep.address}/address?v=1`), 'agent address')).address as Address;
  return { address: prep.address, owner, agent };
}

export const linPolicy = (s: Stack, validUntil: bigint): Policy => ({
  autoCap: 200_000_000n, hardCap: 2_000_000_000n, dailyBudget: 500_000_000n, monthlyBudget: 3_000_000_000n, dailyCount: 10, bufferUsdc: 1_000_000_000n,
  payees: [labelAddress('landlord'), labelAddress('utilities'), labelAddress('cafe')],
  merchants: [merchantKey(PARTNER(s), merchantRef('KOWLOON-LETTINGS'))],
  bands: [
    { token: s.base.usdc, minBps: 4000, targetBps: 5500, maxBps: 6000 },
    { token: s.base.txau, minBps: 2000, targetBps: 3000, maxBps: 3500 },
    { token: s.base.txag, minBps: 0, targetBps: 1500, maxBps: 1500 },
  ],
  maxRebalancesPerDay: 1, maxTradeUsd: 1_000_000_000n, maxSlippageBps: 100, validUntil, soterEnabled: true,
});

/** Owner action authorised by the owner's passkey, co-signed by the bank when needed, submitted by the bundler. */
export async function ownerAction(s: Stack, acc: Account, args: Parameters<typeof ownerActionPayload>[0], fiscoRef: Hex = `0x${'00'.repeat(32)}`, withBank = true) {
  const { payload, payloadHash } = ownerActionPayload(args);
  const now = await baseNow(pub(s));
  const a = { account: acc.address, action: args.kind, payloadHash, nonce: BigInt(keccak256(toHex(`${Date.now()}-${Math.random()}`))) % 2n ** 64n, expiresAt: now + 600n, fiscoRef };
  const d = digest(praetorDomain(s.base.domainName, s.base.mandateHook), 'OwnerAction', a);
  const bankSigs = withBank ? [(await ok(member(s, 'bank', '/owner-actions/cosign', { ownerAction: a, payload }), 'bank cosign')).bankSig as Hex] : [];
  const data = encodeFunctionData({ abi: MandateHookAbi, functionName: 'applyOwnerAction', args: [a, payload, passkeyAuth(acc.owner.credIdHash, acc.owner.sign(d)), bankSigs] });
  const r = await ok(bundler(s, '/tx', { to: s.base.mandateHook, data }), 'applyOwnerAction');
  if (!r.success) throw new Error(`owner action ${args.kind} reverted`);
}

/** KYA (bank), policy (bank check + owner + bank), agent key (owner + bank). */
/** An invented person for the demo KYC of a seeded account (never a real one). */
export const demoPerson = (label: string) => ({ fullName: `Demo Person ${label}`, birthdate: '1990-04-02', nationality: 'HK', documentNumber: `D${keccak256(toHex(label)).slice(2, 10)}` });

/**
 * F1 steps 5 to 14 the way the api runs them: KYC (bank, demo provider) bound to the account, the agent-signer quote
 * verified by the bank, the agent's WeID, the AgentMandate signed with the owner's passkey and countersigned, the KYA
 * the bank builds from all that, then the policy (bank check + owner + bank) and the agent key (owner + bank).
 */
export async function onboard(s: Stack, acc: Account, policy: Policy = linPolicy(s, 0n), o: { userRef?: string; label?: string } = {}): Promise<void> {
  const now = await baseNow(pub(s));
  const agent = acc.agent;
  const userRef = o.userRef ?? `seed-${acc.address.slice(2).toLowerCase()}`;
  const kyc = await ok(member(s, 'bank', `/kyc/status/${userRef}`), 'KYC status');
  if (kyc.state !== 'issued') await kycViaVendor(s, userRef, acc.address, demoPerson(o.label ?? acc.address));
  const p = { ...policy, validUntil: policy.validUntil || now + 31_536_000n };
  const [current] = await read<readonly [Address]>(s, 'kyaOf', [acc.address]);
  if (current.toLowerCase() !== agent.toLowerCase()) {
    const { nonce } = await ok(member(s, 'bank', '/kya/nonce', { account: acc.address }), 'KYA nonce');
    const { quote } = await ok(signer(s, 'api', `/v1/agents/${acc.address}/attest`, { nonce, keyVersion: 1 }), 'agent quote');
    await ok(member(s, 'bank', '/kya/verify', { account: acc.address, agentKey: agent, quote, nonce }), 'KYA quote check');
    const did = await ok(member(s, 'bank', '/kya/agent-did', { account: acc.address }), 'agent DID');
    const draft = await ok(member(s, 'bank', '/kya/mandate/prepare', {
      userRef, account: acc.address, agentKey: agent, scopes: ['rebalance', 'pay', 'standing_orders'], mandateHash: keccak256(encodePolicy(p)),
    }), 'mandate draft');
    const a = acc.owner.sign(draft.challenge as Hex);
    await ok(member(s, 'bank', '/kya/mandate/sign', {
      draftId: draft.draftId, assertion: { credentialId: acc.owner.credIdHash, authenticatorData: a.authenticatorData, clientDataJSON: a.clientDataJSON, r: toHex(a.r, { size: 32 }), s: toHex(a.s, { size: 32 }) },
    }), 'mandate countersignature');
    await ok(member(s, 'bank', '/kya', { account: acc.address, agentDidHash: did.agentDidHash, validUntil: (now + 31_536_000n).toString() }), 'KYA');
    await waitFor('KYA on Base', async () => ((await read<readonly [Address]>(s, 'kyaOf', [acc.address]))[0].toLowerCase() === agent.toLowerCase()));
  }
  const check = await ok(member(s, 'bank', '/policy/check', { account: acc.address, policy: encodePolicy(p) }), 'policy check');
  if (!check.ok) throw new Error(`policy refused by the bank: rule ${check.failedRule}`);
  await ownerAction(s, acc, { kind: K.SET_POLICY, account: acc.address, policy: p }, check.fiscoRef);
  await ownerAction(s, acc, { kind: K.SET_AGENT_KEY, account: acc.address, agentKey: agent, validUntil: Number(now + 2_592_000n) });
}

const fiat = parseAbi(['function masterMinter() view returns (address)', 'function configureMinter(address,uint256) returns (bool)', 'function mint(address,uint256) returns (bool)']);

/** Fork only: Circle's FiatToken minted through an impersonated master minter. */
async function mintUsdc(s: Stack, to: Address, amount: bigint) {
  const p = pub(s);
  const master = await p.readContract({ address: s.base.usdc, abi: fiat, functionName: 'masterMinter' });
  const minter = labelAddress('usdc-minter');
  for (const a of [master, minter]) {
    await p.request({ method: 'anvil_impersonateAccount' as never, params: [a] as never });
    await p.request({ method: 'anvil_setBalance' as never, params: [a, '0xde0b6b3a7640000'] as never });
  }
  const w = createWalletClient({ chain: baseSepolia, transport: http(s.baseRpc) });
  await p.waitForTransactionReceipt({ hash: await w.writeContract({ address: s.base.usdc, abi: fiat, functionName: 'configureMinter', args: [minter, amount], account: master, chain: baseSepolia }) });
  await p.waitForTransactionReceipt({ hash: await w.writeContract({ address: s.base.usdc, abi: fiat, functionName: 'mint', args: [to, amount], account: minter, chain: baseSepolia }) });
}

/** The treasury desk pays USDC for metal sold to it: keep it stocked on the fork (live: the treasury funds it). */
export async function ensureDeskLiquidity(s: Stack, minUsdc = 50_000_000_000n): Promise<void> {
  const bal = await pub(s).readContract({ address: s.base.usdc, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [s.base.treasuryDesk] });
  if (bal < minUsdc) await mintUsdc(s, s.base.treasuryDesk, minUsdc * 2n - bal);
}

/** Lin's starting portfolio (spec 00): 5,300 USDC, 3,200 USD of tXAU, 1,500 USD of tXAG at the seeded prices. */
export async function fund(s: Stack, acc: Account, usdc = 5_300_000_000n, xauUsd6 = 3_200_000_000n, xagUsd6 = 1_500_000_000n): Promise<void> {
  const p = pub(s);
  await mintUsdc(s, acc.address, usdc);
  const desk = createWalletClient({ chain: baseSepolia, transport: http(s.baseRpc), account: privateKeyToAccount(localKey(s, 'DESK_OPERATOR_KEY')) });
  for (const [token, usd6, price] of [[s.base.txau, xauUsd6, 265_000_000_000n], [s.base.txag, xagUsd6, 3_112_000_000n]] as const) {
    await p.waitForTransactionReceipt({ hash: await desk.writeContract({ address: token, abi: PraetorTokenAbi, functionName: 'mint', args: [acc.address, usd6 * 10n ** 20n / price], chain: baseSepolia }) });
  }
}

/** An agent userOp signed by agent-signer with the key acc.agent (the seed acts as mcp, its only allowed caller). */
export async function agentOp(s: Stack, acc: Account, calls: Call[]) {
  const p = await ok(bundler(s, '/userop/prepare', { sender: acc.address, callData: encodeExecute(calls), validator: 'agent' }), 'prepare agent op');
  const { signature } = await ok(signer(s, 'mcp', `/v1/agents/${acc.address}/sign-userop`, { userOp: p.userOp, chainId: 84532, entryPoint: ENTRY_POINT, agentKey: acc.agent }), 'agent signature');
  return bundler(s, '/userop/send', { userOp: { ...p.userOp, signature } });
}

/** KYC through the bank's Demo-provider path (session, HMAC-signed decision, suitability): what the api and
 *  kyc-vendor-mock do for a user. The person data stays in the bank's sealed record. */
export async function kycViaVendor(s: Stack, userRef: string, account: Address, person: { fullName: string; birthdate: string; nationality: string; documentNumber: string }) {
  const { createHmac } = await import('node:crypto');
  const sess = await ok(member(s, 'bank', '/kyc/sessions', { userRef, account, method: 'vendor' }), 'kyc session');
  const raw = json({ sessionId: sess.sessionId, decision: 'approved', liveness: true, person, docHash: `0x${'1'.repeat(64)}`, selfieHash: `0x${'2'.repeat(64)}` });
  const r = await fetch(`${s.members.bank}/kyc/vendor/callback`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-praetor-signature': `sha256=${createHmac('sha256', s.env.KYC_VENDOR_HMAC!).update(raw).digest('hex')}` } });
  if (r.status !== 204) throw new Error(`kyc callback: ${r.status}`);
  return ok(member(s, 'bank', '/suitability', { userRef, answers: [1, 1, 1, 1, 1] }), 'suitability');
}

// ---------------------------------------------------------------- agent (M8)

/** The names the owner gave its payees, as the api will store them in mcp (M9). */
export async function setPayeeLabels(s: Stack, account: Address, labels: { address: Address; label: string }[]) {
  const r = await fetch(`${s.mcp}/internal/payee-labels`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.env.INTERNAL_TOKEN_API}` }, body: json({ account, labels }) });
  if (r.status !== 204) throw new Error(`payee labels: ${r.status}`);
}

const runner = (s: Stack, method: string, path: string, body?: unknown) =>
  fetch(`${s.agentRunner}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${s.env.INTERNAL_TOKEN_AGENT}` }, body: body === undefined ? undefined : json(body) });

/** Automated tests only: this account's agent runs the scripted model, and its next steps are these, for chat turns
 *  or for scheduler wakes (kept apart, so a wake never consumes a chat's steps). */
export async function scriptAgent(s: Stack, account: Address, steps: ({ tool: string; args: Record<string, unknown> } | { text: string })[], turn: 'chat' | 'wake' = 'chat') {
  if ((await runner(s, 'PUT', `/accounts/${account}/model`, { model: 'fake/scripted' })).status !== 204) throw new Error('model override refused');
  const r = await fetch(`${s.fakeLlm}/admin/script/${account.toLowerCase()}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ steps, turn }) });
  if (r.status !== 204) throw new Error(`fake llm script: ${r.status}`);
}

export type AgentTurn = { text: string; tools: { tool: string; status: string; input: unknown; output: unknown }[] };

/** One chat turn through agent-runner (what the api will do for the user's chat). */
export async function agentChat(s: Stack, account: Address, message: string): Promise<AgentTurn> {
  const r = await runner(s, 'POST', '/chat', { account, message });
  const text = await r.text();
  const ev = text.split('\n\n').find((b) => b.startsWith('event: result'));
  if (!ev) throw new Error(`agent chat failed: ${text.slice(0, 300)}`);
  return JSON.parse(ev.slice(ev.indexOf('data: ') + 6)) as AgentTurn;
}

/** The last turn of an account's agent (a scheduler wake), if any. */
export async function lastAgentTurn(s: Stack, account: Address): Promise<(AgentTurn & { reason: string; error?: string }) | null> {
  const r = await runner(s, 'GET', `/accounts/${account}/last`);
  return r.status === 200 ? r.json() : null;
}

/** Waits for a fresh operator heartbeat (the agent's actions are STALE_STATUS without one). */
export async function waitHeartbeat(s: Stack) {
  await waitFor('fresh heartbeat', async () => {
    const [, , , hb] = await read<readonly [number, number, number, bigint]>(s, 'statusOf', ['0x0000000000000000000000000000000000000001']);
    return BigInt(hb) > (await baseNow(pub(s)));
  }, 400_000);
}

export { toJson, fromJson };
