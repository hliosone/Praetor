// Executors: what each kind of case input does against the stack, and what the stack answered. A step may prepare
// (before the snapshot), runs the attack, and may clean up after the effects are judged. `accepted` means the stack
// took the attacker's request (a userOp or transaction that succeeded, an HTTP request that was served).
import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { encodeFunctionData, getAddress, isAddressEqual, keccak256, parseAbi, parseAbiItem, toHex, zeroAddress, type Address, type Hex } from 'viem';
import { entryPoint07Abi } from 'viem/account-abstraction';
import { privateKeyToAccount } from 'viem/accounts';
import { MandateHookAbi, PriceOracleAbi, StandingOrdersAbi } from '@praetor/chain';
import {
  OwnerActionKind as K, REASONS, ZERO_HASH, callHash, digest, encodePasskeySignature, passkeyAuth, praetorDomain, soterAuth, softPasskey,
  type ReasonName, type SoterApproval,
} from '@praetor/protocol';
import { ENTRY_POINT, fromJson, toJson, userOpHash, withPaymasterSignature } from '@praetor/userop';
import { agentChat, bundler, http2, labelAddress, localKey, openAndSign, root, scriptAgent, signer, waitFor } from '../../../scripts/demo/lib.js';
import type { Case, Driver, Input, Layer } from './case.js';
import { aaLayer, analyzeTurn, toolText, type Observation } from './classify.js';
import { encodeCall, encodeCallData, resolveValue, type Vars } from './resolve.js';
import { URLS, runTag, type Fixture, type Fixtures } from './fixtures.js';
import type { Chain } from './chain.js';

export type Ctx = { s: Fixtures['s']; chain: Chain; fixtures: Fixtures; driver: Driver; restores: (() => Promise<void>)[] };
export type Outcome = Omit<Observation, 'executed' | 'effects'> & { accepted?: boolean; executed?: boolean; effects?: string[]; ok: boolean };
export type Step = { prepare?: () => Promise<void>; run: () => Promise<Outcome>; cleanup?: () => Promise<void> };
type Env = { ctx: Ctx; fx: Fixture; vars: Vars; c: Case; since: () => bigint };

const out = (layer: Outcome['layer'], o: Partial<Outcome> & { detail: string }): Outcome => ({ layer, txHashes: [], ok: false, ...o });
const u64 = () => BigInt(`0x${randomBytes(8).toString('hex')}`);

// ---------------------------------------------------------------- userOps (agent key through agent-signer, or the owner's passkey)

async function sendOp(e: Env, callData: Hex, validator: 'agent' | 'passkey', nonceKey?: 'passkey' | 'zero'): Promise<Outcome> {
  const { s, chain } = e.ctx;
  const sender = e.fx.acc.address;
  const prep = await bundler(s, '/userop/prepare', { sender, callData, validator });
  if (prep.status >= 300) return out('bundler', { error: String(prep.status), detail: `bundler refused to prepare: ${JSON.stringify(prep.body)}` });
  let op = fromJson(prep.body.userOp);
  let h = prep.body.userOpHash as Hex;
  if (nonceKey === 'zero') {
    // Key 0 = the Safe's own owner check (NoOwner). The bundler signs sponsorship for the nonce it chose, so the
    // attacker (here: a compromised bundler holding the paymaster key) re-sponsors the op.
    const nonce = await chain.p.readContract({ address: ENTRY_POINT, abi: entryPoint07Abi, functionName: 'getNonce', args: [sender, 0n] });
    op = await withPaymasterSignature({ ...op, nonce }, { paymaster: s.base.paymaster, key: localKey(s, 'PAYMASTER_SIGNER_KEY'), validUntil: Number(await chain.now()) + 600, validAfter: 0, chainId: s.base.chainId });
    h = userOpHash(op, s.base.chainId);
  }
  let signature: Hex;
  if (validator === 'agent') {
    const r = await signer(s, 'mcp', `/v1/agents/${sender}/sign-userop`, { userOp: toJson(op), chainId: s.base.chainId, entryPoint: ENTRY_POINT, keyVersion: 1 });
    if (r.status >= 300) return out('agent-signer', { error: String(r.status), detail: `agent-signer refused to sign: ${r.body?.error ?? r.status}` });
    signature = r.body.signature as Hex;
  } else {
    signature = encodePasskeySignature(e.fx.acc.owner.credIdHash, e.fx.acc.owner.sign(h));
  }
  const sent = await bundler(s, '/userop/send', { userOp: toJson({ ...op, signature }) });
  if (sent.status === 422) {
    const aa = String(sent.body?.detail ?? '');
    return out(aaLayer(aa), { error: aa, detail: `rejected by the bundler's EntryPoint simulation: ${aa}` });
  }
  if (sent.status >= 300) return out('bundler', { error: String(sent.status), detail: `bundler refused: ${JSON.stringify(sent.body)}` });
  const b = sent.body as { success: boolean | null; txHash: Hex | null; refusalLogTx: Hex | null; reasons: number[]; skipped: boolean; userOpHash: Hex };
  const txHashes = [b.txHash, b.refusalLogTx].filter((x): x is Hex => !!x);
  if (b.success) return out('none', { accepted: true, ok: true, txHashes, detail: 'userOp executed' });
  const logged = REASONS[b.reasons.find((r) => r !== 0) ?? 0];
  if (b.skipped) return out('bundler', { reason: logged, detail: 'refused by check(); the bundler did not submit it (BUNDLER_SKIP_REFUSED)' });
  // The executed revert (call trace), else the hook's preCheck at the same state, else what check() logged.
  const traced = b.txHash ? await chain.refusalInTx(b.txHash) : undefined;
  const reason = traced ?? (await chain.preCheckReason(sender, callData)) ?? (logged !== 'OK' ? logged : undefined);
  const rec = (await chain.refusals(sender, e.since(), await chain.block())).find((r) => r.userOpHash === b.userOpHash);
  // The tier comes from the RefusalLog record (the hook's check()) only when it names the same reason.
  const tier = rec && rec.reason === reason ? rec.tier : undefined;
  const notes = [`userOp mined and failed: the hook reverted ${reason ?? '(reason not decoded)'}${traced ? ' (call trace)' : ''}`];
  if (rec) notes.push(`RefusalLog recorded ${rec.reason} ${rec.tier}`);
  else notes.push('no RefusalLog record (check() found no refused call)');
  return out('hook', { reason, tier, txHashes, detail: notes.join('; ') });
}

// ---------------------------------------------------------------- plain transactions from an attacker

function layerOf(e: Env, to: Address): Layer {
  const b = e.ctx.s.base;
  if (isAddressEqual(to, b.mandateHook)) return 'hook';
  if (isAddressEqual(to, b.usdc)) return 'usdc';
  if (isAddressEqual(to, b.standingOrders)) return 'executor';
  if (isAddressEqual(to, b.payoutRail)) return 'payout-rail';
  return 'safe';
}

async function attackTx(e: Env, label: string, to: Address, data: Hex, value = 0n): Promise<Outcome> {
  const r = await e.ctx.chain.attackTx(`${label}-${e.c.id}-${runTag}`, to, data, value);
  if (r.success) return out(layerOf(e, to), { accepted: true, ok: true, txHashes: [r.txHash], detail: 'the transaction succeeded' });
  const traced = await e.ctx.chain.refusalInTx(r.txHash);
  return out(layerOf(e, to), { error: r.error, reason: traced, txHashes: [r.txHash], detail: `reverted ${r.error ?? ''}${traced ? ` (hook MandateRefused ${traced} in the trace)` : ''}`.trim() });
}

// ---------------------------------------------------------------- consortium attestations

const ROLE_KEYS: Record<string, string> = { bank: 'BANK', regulator: 'REGULATOR', operator: 'OPERATOR' };
const N_SECP = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function signerKey(e: Env, key: string): Hex {
  const [env, role] = key.startsWith('live-') ? ['LIVE', key.slice(5)] : ['LOCAL', key];
  if (ROLE_KEYS[role!]) return e.ctx.s.env[`${env}_${ROLE_KEYS[role!]}_BASE_SIGNER_KEY`] as Hex;
  return keccak256(toHex(`praetor-redteam-forger:${key}:${e.c.id}`));
}

async function attestation(e: Env, i: Extract<Input, { kind: 'attestation' }>): Promise<Outcome> {
  const s = e.ctx.s;
  const m = resolveValue(i.message, e.vars, await e.ctx.chain.now()) as Record<string, string | number | boolean>;
  const big = (k: string) => BigInt(String(m[k]));
  const typed = {
    StatusAttestation: () => ({ account: getAddress(String(m.account)), status: Number(m.status), nonce: big('nonce'), deadline: big('deadline'), fiscoRef: m.fiscoRef as Hex }),
    SanctionsAttestation: () => ({ target: getAddress(String(m.target)), listed: m.listed === true || m.listed === 'true', nonce: big('nonce'), deadline: big('deadline'), fiscoRef: m.fiscoRef as Hex }),
    AssetAttestation: () => ({ asset: getAddress(String(m.asset)), kind: Number(m.kind), status: Number(m.status), maxWeightBps: Number(m.maxWeightBps), nonce: big('nonce'), deadline: big('deadline'), fiscoRef: m.fiscoRef as Hex }),
    HeartbeatAttestation: () => ({ epoch: big('epoch'), validUntil: big('validUntil'), deadline: big('deadline') }),
  }[i.type]();
  const sigs: { signer: Address; sig: Hex }[] = [];
  for (const sg of i.signers) {
    const acct = privateKeyToAccount(signerKey(e, sg.key));
    const d = digest(praetorDomain(sg.domain ?? s.base.domainName, s.base.mandateHook), i.type, typed as never);
    let sig = await acct.sign({ hash: d });
    if (sg.malleate) {
      const r = sig.slice(2, 66);
      const sv = BigInt(`0x${sig.slice(66, 130)}`);
      const v = parseInt(sig.slice(130, 132), 16);
      sig = `0x${r}${(N_SECP - sv).toString(16).padStart(64, '0')}${(v === 27 ? 28 : 27).toString(16)}` as Hex;
    }
    sigs.push({ signer: acct.address, sig });
  }
  if (!i.keepOrder) sigs.sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1));
  const fn = { StatusAttestation: 'applyStatus', SanctionsAttestation: 'applySanctions', AssetAttestation: 'applyAsset', HeartbeatAttestation: 'applyHeartbeat' }[i.type];
  const data = encodeFunctionData({ abi: MandateHookAbi, functionName: fn as 'applyStatus', args: [typed as never, sigs.map((x) => x.sig)] });
  return attackTx(e, 'attestation', s.base.mandateHook, data);
}

// ---------------------------------------------------------------- HTTP

export type RawResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: string };

/** node:http(s) without TLS verification for Caddy's internal CA; praetor.localhost is dialled on 127.0.0.1. */
export function rawRequest(url: string, o: { method: string; headers?: Record<string, string>; body?: string }): Promise<RawResponse> {
  const u = new URL(url);
  const https = u.protocol === 'https:';
  const host = u.hostname.endsWith('.localhost') ? '127.0.0.1' : u.hostname;
  return new Promise((resolve, reject) => {
    const req = (https ? httpsRequest : httpRequest)({
      host, port: u.port || (https ? 443 : 80), path: `${u.pathname}${u.search}`, method: o.method, servername: u.hostname, rejectUnauthorized: false,
      headers: { host: u.host, ...(o.body !== undefined ? { 'content-length': String(Buffer.byteLength(o.body)) } : {}), ...o.headers },
      timeout: 30_000,
    }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => { body += c.toString('utf8'); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    // A server that switches protocols ends the HTTP exchange here.
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve({ status: res.statusCode ?? 101, headers: res.headers, body: '' }); });
    req.on('timeout', () => req.destroy(new Error(`timeout ${url}`)));
    req.on('error', reject);
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}

const cookieHeader = (fx: Fixture) => [...(fx.web?.cookies ?? new Map())].map(([k, v]) => `${k}=${v}`).join('; ');

function httpLayer(url: string): Layer {
  const u = new URL(url);
  if (u.pathname.startsWith('/oauth') || u.pathname.startsWith('/.well-known')) return 'oauth';
  if (u.pathname.startsWith('/mcp')) return 'mcp';
  if (u.pathname.startsWith('/api')) return 'api';
  return 'web';
}

async function httpStep(e: Env, i: Extract<Input, { kind: 'http' }>): Promise<Outcome> {
  const now = await e.ctx.chain.now();
  const url = resolveValue(i.url, e.vars, now) as string;
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(i.headers ?? {}) };
  if (i.session) {
    if (!e.fx.web) throw new Error('an http case with session needs the web fixture');
    headers.cookie = cookieHeader(e.fx);
    const me = await rawRequest(`${URLS.api}/api/me`, { method: 'GET', headers: { cookie: headers.cookie } });
    if (me.status !== 200) throw new Error(`control failed: the session is not accepted (GET /api/me ${me.status})`);
    if (i.csrf === 'valid') headers['x-csrf-token'] = e.fx.web.cookies.get('praetor_csrf') ?? '';
    if (i.csrf === 'forged') headers['x-csrf-token'] = randomBytes(32).toString('base64url').slice(0, 43);
  }
  const body = i.body === undefined ? undefined : typeof i.body === 'string' ? i.body : JSON.stringify(resolveValue(i.body, e.vars, now));
  const r = await rawRequest(url, { method: i.method, headers, body });
  const accepted = (r.status >= 200 && r.status < 300) || r.status === 101;
  const control = i.session ? 'control GET /api/me with the same cookies: 200; ' : '';
  return out(httpLayer(url), { accepted, ok: accepted, error: String(r.status), detail: `${control}${i.method} ${new URL(url).pathname}: ${r.status} ${r.body.slice(0, 120).replace(/\s+/g, ' ')}` });
}

// ---------------------------------------------------------------- chat with the agent

async function chat(e: Env, i: Extract<Input, { kind: 'chat' }>): Promise<Outcome> {
  const { s, chain, driver } = e.ctx;
  const now = await chain.now();
  const account = e.fx.acc.address;
  const script = resolveValue(i.script ?? [], e.vars, now) as Parameters<typeof scriptAgent>[2];
  if (driver === 'scripted') await scriptAgent(s, account, script);
  const fakeCalls = async () => ((await fetch(`${s.fakeLlm}/admin/log/${account.toLowerCase()}`).then((r) => r.json()).catch(() => [])) as unknown[]).length;
  const fakeBefore = driver === 'live' ? await fakeCalls() : 0;
  let t;
  try {
    t = await agentChat(s, account, resolveValue(i.message, e.vars, now) as string);
  } catch (err) {
    const hung = await hungBuiltinTool(e);
    if (!hung) throw err;
    return out('agent-runner', {
      error: 'hung', detail: `the built-in tool ${hung} was neither rejected nor run: the turn timed out (agent-runner's permission rejector never answered it) and the account's agent session stays blocked`,
    });
  }
  if (driver === 'live' && (await fakeCalls()) > fakeBefore) throw new Error('control failed: this live turn was answered by the scripted fake model, not the real one');
  return analyzeTurn(t, await chain.refusals(account, e.since(), await chain.block()), script, driver);
}

/** A built-in tool still `running` in the agent's last turn (agent-runner transcript), if any. */
async function hungBuiltinTool(e: Env): Promise<string | undefined> {
  const s = e.ctx.s;
  const r = await fetch(`${s.agentRunner}/accounts/${e.fx.acc.address}/transcript`, { headers: { authorization: `Bearer ${s.env.INTERNAL_TOKEN_AGENT}` } }).catch(() => null);
  if (!r?.ok) return undefined;
  const msgs = (await r.json()) as { info: { role: string }; parts: { type: string; tool?: string; state?: { status?: string } }[] }[];
  const last = [...msgs].reverse().find((m) => m.info.role === 'assistant');
  return last?.parts.find((p) => p.type === 'tool' && p.state?.status === 'running' && !String(p.tool).startsWith('praetor_'))?.tool;
}

// ---------------------------------------------------------------- custom executors

type Custom = (e: Env, p: Record<string, unknown>) => Step;

const tier2Data = async (e: Env, call: { to: Address; value: bigint; data: Hex }, expiresIn: bigint) => {
  const { s, chain } = e.ctx;
  const a = { account: e.fx.acc.address, callHash: callHash({ account: e.fx.acc.address, target: call.to, value: call.value, data: call.data }), nonce: u64(), expiresAt: (await chain.now()) + expiresIn };
  const d = digest(praetorDomain(s.base.domainName, s.base.mandateHook), 'Tier2Approval', a);
  return { a, d, auth: passkeyAuth(e.fx.acc.owner.credIdHash, e.fx.acc.owner.sign(d)) };
};
const registerData = (a: unknown, auth: unknown) => encodeFunctionData({ abi: MandateHookAbi, functionName: 'registerApproval', args: [a as never, auth as never] });

/** The owner approves one call with the passkey; the api registers it through the bundler (and mcp may send it). */
const registerApproval: Custom = (e, p) => ({
  run: async () => {
    const call = encodeCall(p.call as never, e.vars, await e.ctx.chain.now());
    const { a, auth } = await tier2Data(e, call, 600n);
    const r = await bundler(e.ctx.s, '/tx', { to: e.ctx.s.base.mandateHook, data: registerData(a, auth) });
    if (!r.body?.success) return out('hook', { detail: `registerApproval failed: ${JSON.stringify(r.body)}` });
    if (p.execute) {
      const o = await sendOp(e, encodeCallData({ execute: { calls: [p.call as never] } }, e.vars, await e.ctx.chain.now()), 'agent');
      return { ...o, ok: o.accepted === true, detail: `approval registered and the call executed: ${o.detail}` };
    }
    return out('none', { ok: true, txHashes: [r.body.txHash], detail: 'approval registered' });
  },
});

const tier2: Custom = (e, p) => {
  let data: Hex;
  return {
    prepare: async () => {
      const call = encodeCall({ to: '$usdc', fn: 'transfer(address,uint256)', args: ['$attacker', 'usdc:150'] }, e.vars, await e.ctx.chain.now());
      if (p.variant === 'replay') {
        const { a, auth } = await tier2Data(e, call, 600n);
        data = registerData(a, auth);
        const r = await bundler(e.ctx.s, '/tx', { to: e.ctx.s.base.mandateHook, data });
        if (!r.body?.success) throw new Error(`replay setup: registerApproval failed ${JSON.stringify(r.body)}`);
        const o = await sendOp(e, encodeCallData({ execute: { calls: [{ to: '$usdc', fn: 'transfer(address,uint256)', args: ['$attacker', 'usdc:150'] }] } }, e.vars, await e.ctx.chain.now()), 'agent');
        if (!o.accepted) throw new Error(`replay setup: the approved call did not execute (${o.detail})`);
      } else if (p.variant === 'other-callhash') {
        const { a, auth } = await tier2Data(e, call, 600n);
        const other = encodeCall({ to: '$usdc', fn: 'transfer(address,uint256)', args: ['$attacker2', 'usdc:1500'] }, e.vars, await e.ctx.chain.now());
        data = registerData({ ...a, callHash: callHash({ account: e.fx.acc.address, target: other.to, value: other.value, data: other.data }) }, auth);
      } else if (p.variant === 'expired') {
        const { a, auth } = await tier2Data(e, call, 0n);
        data = registerData({ ...a, expiresAt: a.expiresAt - 1n }, auth);
        // The owner signs the expired approval itself (so only the expiry is wrong).
        const d = digest(praetorDomain(e.ctx.s.base.domainName, e.ctx.s.base.mandateHook), 'Tier2Approval', { ...a, expiresAt: a.expiresAt - 1n });
        data = registerData({ ...a, expiresAt: a.expiresAt - 1n }, passkeyAuth(e.fx.acc.owner.credIdHash, e.fx.acc.owner.sign(d)));
      } else throw new Error(`unknown tier2 variant ${String(p.variant)}`);
    },
    run: () => attackTx(e, `tier2-${String(p.variant)}`, e.ctx.s.base.mandateHook, data),
  };
};

const soter: Custom = (e, p) => {
  let data: Hex;
  const fx = e.fx;
  return {
    prepare: async () => {
      if (!fx.phone) throw new Error('the soter executor needs the soter fixture (a linked phone)');
      const { s, chain, fixtures } = e.ctx;
      const now = await chain.now();
      const binding = await chain.hook<Hex>('bindingOf', [fx.acc.address]);
      const stored = Number(await chain.hook<bigint>('soterCounterOf', [binding]));
      const call = encodeCall({ to: '$usdc', fn: 'transfer(address,uint256)', args: ['$attacker', 'usdc:150'] }, e.vars, now);
      const a = { account: fx.acc.address, callHash: callHash({ account: fx.acc.address, target: call.to, value: call.value, data: call.data }), nonce: u64(), expiresAt: now + 600n };
      const d = digest(praetorDomain(s.base.domainName, s.base.mandateHook), 'Tier2Approval', a);
      let auth: { kind: number; data: Hex };
      if (p.variant === 'counter-replay') {
        // A legit SOTER approval moves the counter to stored + 1 (registered, never used), then a new one reuses it.
        const other = encodeCall({ to: '$usdc', fn: 'transfer(address,uint256)', args: ['$attacker2', 'usdc:150'] }, e.vars, now);
        const b = { account: fx.acc.address, callHash: callHash({ account: fx.acc.address, target: other.to, value: other.value, data: other.data }), nonce: u64(), expiresAt: now + 600n };
        const db = digest(praetorDomain(s.base.domainName, s.base.mandateHook), 'Tier2Approval', b);
        const first = await fixtures.soterSign(fx.acc.address, db, fx.phone, stored + 1, now + 600n);
        const r = await bundler(s, '/tx', { to: s.base.mandateHook, data: registerData(b, soterAuth(first.proof, first.attesterSig)) });
        if (!r.body?.success) throw new Error(`counter-replay setup: the first SOTER approval failed ${JSON.stringify(r.body)}`);
        const again = await fixtures.soterSign(fx.acc.address, d, fx.phone, stored + 1, now + 600n);
        auth = soterAuth(again.proof, again.attesterSig);
      } else if (p.variant === 'other-binding') {
        const phone2 = { code: `rt-${runTag}-phone2-${e.c.id}`, uid: `uid2-rt-${runTag}`, cpu: `cpu2-rt-${runTag}` };
        const r = await fixtures.soterSign(fx.acc.address, d, phone2, stored + 5, now + 600n);
        auth = soterAuth(r.proof, r.attesterSig);
      } else if (p.variant === 'inactive-attester') {
        const sa: SoterApproval = { account: fx.acc.address, digest: d, bindingHash: binding, soterCounter: BigInt(stored + 1), expiresAt: now + 600n };
        const fake = privateKeyToAccount(keccak256(toHex(`praetor-redteam-attester:${e.c.id}`)));
        auth = soterAuth(sa, await fake.sign({ hash: digest(praetorDomain(s.base.domainName, s.base.mandateHook), 'SoterApproval', sa) }));
      } else if (p.variant === 'set-owner-key') {
        const thief = softPasskey(`rt-thief-${e.c.id}-${runTag}`, s.rpId, s.origin);
        const args = { kind: K.SET_OWNER_KEY, account: fx.acc.address, credIdHash: thief.credIdHash, x: thief.x, y: thief.y } as const;
        const { ownerActionPayload } = await import('@praetor/protocol');
        const { payload, payloadHash } = ownerActionPayload(args);
        const oa = { account: fx.acc.address, action: K.SET_OWNER_KEY, payloadHash, nonce: u64(), expiresAt: now + 600n, fiscoRef: ZERO_HASH };
        const od = digest(praetorDomain(s.base.domainName, s.base.mandateHook), 'OwnerAction', oa);
        const proof = await fixtures.soterSign(fx.acc.address, od, fx.phone, stored + 1, now + 600n);
        const cos = await http2(`${s.members.bank}/owner-actions/cosign`, s.env.INTERNAL_TOKEN_MEMBERS!, { ownerAction: oa, payload });
        const bankSigs = cos.status === 200 ? [cos.body.bankSig as Hex] : [];
        data = encodeFunctionData({ abi: MandateHookAbi, functionName: 'applyOwnerAction', args: [oa, payload, soterAuth(proof.proof, proof.attesterSig), bankSigs] });
        return;
      } else throw new Error(`unknown soter variant ${String(p.variant)}`);
      data = registerData(a, auth);
    },
    run: () => attackTx(e, `soter-${String(p.variant)}`, e.ctx.s.base.mandateHook, data),
  };
};

const STATUS_APPLIED = 'event StatusApplied(address indexed account, uint8 status, uint64 nonce, bytes32 fiscoRef, uint8 signerCount)';
const replayStatus: Custom = (e) => {
  let data: Hex | undefined;
  return {
    prepare: async () => {
      const logs = await e.ctx.chain.hookLogs(STATUS_APPLIED, { account: e.fx.acc.address });
      const last = logs.at(-1);
      if (!last) throw new Error('no delivered StatusAttestation for this account to replay');
      const sel = encodeFunctionData({ abi: MandateHookAbi, functionName: 'applyStatus', args: [{ account: zeroAddress, status: 0, nonce: 0n, deadline: 0n, fiscoRef: ZERO_HASH }, []] }).slice(0, 10) as Hex;
      data = await e.ctx.chain.innerCall(last.transactionHash!, e.ctx.s.base.mandateHook, sel);
      if (!data) throw new Error(`could not read the delivered applyStatus input from ${last.transactionHash}`);
    },
    run: () => attackTx(e, 'replay-status', e.ctx.s.base.mandateHook, data!),
  };
};

const ORDER_EXECUTED = 'event StandingOrderExecuted(address indexed account, uint32 indexed id, uint256 amount, uint64 periodIndex, address trigger)';
const standingOrder: Custom = (e, p) => {
  const { s, chain, fixtures } = e.ctx;
  const id = Number(BigInt(keccak256(toHex(`rt-order-${e.c.id}-${e.fx.driver}-${runTag}`))) % 2_000_000_000n) + 1;
  const amount = { 'trigger-twice': 100_000_000n, 'over-hard-cap': 2_500_000_000n, 'over-bank-cap': 6_000_000_000n, frozen: 50_000_000n }[String(p.variant)] ?? 0n;
  const execData = encodeFunctionData({ abi: StandingOrdersAbi, functionName: 'execute', args: [e.fx.acc.address, id] });
  const add = async () => {
    const now = await chain.now();
    const order = { account: e.fx.acc.address, id, payee: labelAddress('landlord'), amount, period: 30 * 86_400, firstDue: now, rail: 0, merchantRef: ZERO_HASH };
    return fixtures.ownerActionData(e.fx, { kind: K.ADD_STANDING_ORDER, account: e.fx.acc.address, order }, true);
  };
  const executedCount = async () => (await chain.p.getLogs({ address: s.base.standingOrders, event: parseAbiItem(ORDER_EXECUTED), args: { account: e.fx.acc.address, id }, fromBlock: BigInt(s.base.deployBlock), toBlock: 'latest' })).length;
  let added = false;
  return {
    prepare: async () => {
      if (p.variant === 'over-bank-cap') return;
      const { data, bankError } = await add();
      if (bankError) throw new Error(`the bank refused to co-sign the order: ${bankError}`);
      const r = await bundler(s, '/tx', { to: s.base.mandateHook, data });
      if (!r.body?.success) throw new Error(`ADD_STANDING_ORDER failed: ${JSON.stringify(r.body)}`);
      added = true;
      if (p.variant === 'trigger-twice') {
        // The first payment of the period is allowed: by the scheduler, or by this trigger if it has not run yet.
        if ((await executedCount()) === 0) await chain.attackTx(`first-trigger-${e.c.id}-${runTag}`, s.base.standingOrders, execData).catch(() => undefined);
        await waitFor('first standing order payment', async () => (await executedCount()) === 1, 120_000);
      }
    },
    run: async () => {
      if (p.variant === 'over-bank-cap') {
        const { data, bankError } = await add();
        if (bankError) return out('bank', { error: bankError, detail: `the bank refused to co-sign ADD_STANDING_ORDER of 6,000 USDC: ${bankError}` });
        const r = await bundler(s, '/tx', { to: s.base.mandateHook, data });
        added = !!r.body?.success;
        return out('hook', { accepted: added, detail: `the bank co-signed; applyOwnerAction ${added ? 'succeeded' : 'failed'}` });
      }
      const o = await attackTx(e, `trigger-${String(p.variant)}`, s.base.standingOrders, execData);
      if (o.reason) return { ...o, layer: 'hook', detail: `StandingOrders.execute ${o.detail}` };
      return { ...o, detail: `StandingOrders.execute ${o.detail}` };
    },
    // A refused order stays active and the scheduler would retry it forever: the owner cancels it alone (T3-).
    cleanup: async () => {
      if (!added) return;
      const { data } = await fixtures.ownerActionData(e.fx, { kind: K.CANCEL_STANDING_ORDER, account: e.fx.acc.address, id }, false);
      await bundler(s, '/tx', { to: s.base.mandateHook, data });
    },
  };
};

const staleSim: Custom = (e, p) => ({
  run: async () => {
    const { s, chain } = e.ctx;
    const now = await chain.now();
    const calls = (p.calls as never[]).map((c) => encodeCall(c, e.vars, now));
    let at: bigint;
    if (p.what === 'price') {
      const age = await chain.p.readContract({ address: s.base.priceOracle, abi: PriceOracleAbi, functionName: 'maxPriceAge' });
      at = now + BigInt(age) + 3600n;
    } else {
      const [, , , hb] = await chain.hook<readonly [number, number, number, bigint]>('statusOf', [e.fx.acc.address]);
      at = BigInt(hb) + 60n;
    }
    const data = encodeFunctionData({ abi: MandateHookAbi, functionName: 'checkBatch', args: [e.fx.acc.address, calls.map((c) => ({ target: c.to, value: c.value, callData: c.data }))] });
    const r = await chain.p.call({ to: s.base.mandateHook, data, blockOverrides: { time: at } });
    const { decodeFunctionResult } = await import('viem');
    const [reasons, tiers] = decodeFunctionResult({ abi: MandateHookAbi, functionName: 'checkBatch', data: r.data! }) as readonly [readonly number[], readonly number[], readonly Hex[]];
    const k = reasons.findIndex((x) => x !== 0);
    if (k < 0) return out('none', { accepted: true, detail: `check() at block time ${at} allows the call` });
    const tierNames = ['T0_NEVER', 'T1_AUTONOMOUS', 'T2_HUMAN', 'T3_OWNER', 'T4_CONSORTIUM'] as const;
    return out('hook', { reason: REASONS[reasons[k]!] as ReasonName, tier: tierNames[tiers[k]!], detail: `simulated: hook.checkBatch at block time ${at} (now ${now}) through eth_call with a block override` });
  },
});

const erc1271: Custom = (e, p) => ({
  run: async () => {
    const { s, chain } = e.ctx;
    const usdc = s.base.usdc;
    const acct = e.fx.acc.address;
    const attacker = e.vars.attacker as Address;
    const now = await chain.now();
    const domain = { name: 'USDC', version: '2', chainId: s.base.chainId, verifyingContract: usdc } as const;
    const { hashTypedData } = await import('viem');
    let hash: Hex;
    let call: (sig: Hex) => Hex;
    if (p.method === 'permit') {
      const nonce = await chain.p.readContract({ address: usdc, abi: parseAbi(['function nonces(address) view returns (uint256)']), functionName: 'nonces', args: [acct] });
      const msg = { owner: acct, spender: attacker, value: 1_000_000_000n, nonce, deadline: now + 3600n };
      hash = hashTypedData({ domain, primaryType: 'Permit', types: { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] }, message: msg });
      call = (sig) => encodeFunctionData({ abi: parseAbi(['function permit(address owner, address spender, uint256 value, uint256 deadline, bytes signature)']), functionName: 'permit', args: [acct, attacker, msg.value, msg.deadline, sig] });
    } else {
      const msg = { from: acct, to: attacker, value: 1_000_000_000n, validAfter: 0n, validBefore: now + 3600n, nonce: keccak256(toHex(`rt-3009-${e.c.id}-${runTag}`)) };
      hash = hashTypedData({
        domain, primaryType: 'TransferWithAuthorization',
        types: { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
        message: msg,
      });
      call = (sig) => encodeFunctionData({ abi: parseAbi(['function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)']), functionName: 'transferWithAuthorization', args: [acct, attacker, msg.value, msg.validAfter, msg.validBefore, msg.nonce, sig] });
    }
    // Safe7579 routes ERC-1271 by the first 20 bytes of the signature to one of the account's validators.
    let sig: Hex = '0x';
    if (p.signature === 'passkey') sig = `${s.base.passkeyValidator}${encodePasskeySignature(e.fx.acc.owner.credIdHash, e.fx.acc.owner.sign(hash)).slice(2)}` as Hex;
    if (p.signature === 'agent') sig = `${s.base.agentKeyValidator}${(await privateKeyToAccount(keccak256(toHex(`rt-agent-standin-${runTag}`))).sign({ hash })).slice(2)}` as Hex;
    const o = await attackTx(e, `erc1271-${String(p.method)}-${String(p.signature)}`, usdc, call(sig));
    return { ...o, detail: `${String(p.method)} with a ${String(p.signature)} account signature: ${o.detail}` };
  },
});

/** A JSON-RPC call to mcp's /mcp (stateless streamable HTTP). */
async function mcpRpc(base: string, token: string, method: string, params: unknown, headers: Record<string, string> = {}) {
  const r = await rawRequest(`${base}/mcp`, {
    method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
  });
  const line = r.body.split('\n').find((l) => l.startsWith('data: '));
  let json: unknown = null;
  try {
    json = JSON.parse(line ? line.slice(6) : r.body);
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

const mcpAgentBearer: Custom = (e) => ({
  run: async () => {
    const { s } = e.ctx;
    const t = await http2(`${URLS.mcp}/internal/agent-token`, s.env.INTERNAL_TOKEN_MCP!, { account: e.fx.acc.address });
    if (t.status !== 200) throw new Error(`agent token: ${t.status}`);
    const token = t.body.token as string;
    // Control: through mcp's agent-network address the host's bridge gateway is inside AGENT_SUBNET, so the bearer works.
    const control = await mcpRpc(process.env.MCP_AGENT_URL_HOST ?? 'http://10.90.0.60:3080', token, 'tools/list', {});
    if (control.status !== 200) throw new Error(`control failed: the fresh agent bearer is not accepted on the agent network (${control.status})`);
    const statuses: string[] = [];
    let accepted = false;
    for (const base of [URLS.web, URLS.mcp]) {
      const r = await mcpRpc(base, token, 'tools/list', {});
      statuses.push(`${new URL(base).host} ${r.status}`);
      if (r.status === 200) accepted = true;
    }
    return out('mcp', {
      accepted, error: accepted ? '200' : '401',
      detail: `control: the bearer works on the agent network (10.90.0.60: 200; note: the Docker host's bridge gateway 10.90.0.1 is inside AGENT_SUBNET); from outside it: ${statuses.join(', ')}`,
    });
  },
});

/** Full OAuth 2.1 flow of mcp for the web fixture's session: DCR, consent with the session cookie, PKCE code. */
async function oauthClient(fx: Fixture, redirect = 'https://client.example/cb') {
  const reg = await rawRequest(`${URLS.mcp}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'redteam', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }) });
  if (reg.status !== 201) throw new Error(`oauth register: ${reg.status} ${reg.body.slice(0, 120)}`);
  const clientId = JSON.parse(reg.body).client_id as string;
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = (redirectUri: string) => new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state: 'rt' }).toString();
  const code = async () => {
    const q = query(redirect);
    const page = await rawRequest(`${URLS.mcp}/oauth/authorize?${q}`, { method: 'GET', headers: { cookie: cookieHeader(fx) } });
    const csrf = /name="csrf" value="([^"]+)"/.exec(page.body)?.[1];
    if (page.status !== 200 || !csrf) throw new Error(`oauth consent page: ${page.status}`);
    const post = await rawRequest(`${URLS.mcp}/oauth/authorize?${q}`, { method: 'POST', headers: { cookie: cookieHeader(fx), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: csrf.replace(/&amp;/g, '&'), decision: 'allow' }).toString() });
    const loc = String(post.headers.location ?? '');
    const c = new URL(loc).searchParams.get('code');
    if (post.status !== 302 || !c) throw new Error(`oauth consent: ${post.status}`);
    return c;
  };
  const token = async (body: Record<string, string>) => {
    const r = await rawRequest(`${URLS.mcp}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: clientId, ...body }) });
    let j: Record<string, string> = {};
    try {
      j = JSON.parse(r.body);
    } catch {
      j = {};
    }
    return { status: r.status, json: j };
  };
  return { clientId, verifier, redirect, query, code, token };
}

const mcpCrossAccount: Custom = (e) => ({
  run: async () => {
    const a = await e.ctx.fixtures.get('web', e.ctx.driver, e.c.id);
    const o = await oauthClient(a);
    const t = await o.token({ grant_type: 'authorization_code', code: await o.code(), redirect_uri: o.redirect, code_verifier: o.verifier });
    if (!t.json.access_token) throw new Error(`oauth token: ${t.status}`);
    const b = e.fx.acc.address;
    const bal = (who: Address) => e.ctx.chain.p.readContract({ address: e.ctx.s.base.usdc, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [who] });
    const [a0, b0] = [await bal(a.acc.address), await bal(b)];
    const pay = await mcpRpc(URLS.mcp, t.json.access_token, 'tools/call', { name: 'pay', arguments: { payee: labelAddress('landlord'), amount: '1', account: b }, _meta: { account: b } }, { 'x-praetor-account': b });
    const text = JSON.stringify(pay.json).slice(0, 200);
    const [a1, b1] = [await bal(a.acc.address), await bal(b)];
    const fromA = a0 - a1;
    if (pay.status !== 200 || (fromA !== 1_000_000n && b1 === b0)) throw new Error(`control failed: the tool call did not run for the token's account (${pay.status}, A paid ${fromA}): ${text}`);
    return out('mcp', {
      accepted: b1 < b0, detail: `pay naming account B in its arguments, _meta and a header ran for the token's account A (A paid ${fromA} units, B paid ${b0 - b1}): ${text}`,
    });
  },
});

const oauthRedirect: Custom = (e) => ({
  run: async () => {
    const o = await oauthClient(e.fx);
    const good = await rawRequest(`${URLS.mcp}/oauth/authorize?${o.query(o.redirect)}`, { method: 'GET', headers: { cookie: cookieHeader(e.fx) } });
    if (good.status !== 200 || !/name="csrf"/.test(good.body)) throw new Error(`control failed: the registered redirect does not get the consent page (${good.status})`);
    const variants = ['https://evil.example/cb', 'https://client.example/cb.evil.example', 'https://client.example/cb/../../evil', 'http://client.example/cb', 'https://client.example/cb?next=https://evil.example'];
    const seen: string[] = [];
    let accepted = false;
    for (const v of variants) {
      const r = await rawRequest(`${URLS.mcp}/oauth/authorize?${o.query(v)}`, { method: 'GET', headers: { cookie: cookieHeader(e.fx) } });
      seen.push(`${r.status}${r.headers.location ? ` -> ${String(r.headers.location)}` : ''}`);
      if (r.status !== 400 || r.headers.location) accepted = true;
    }
    return out('oauth', { accepted, error: accepted ? 'accepted' : '400', detail: `control: the registered redirect_uri gets the consent page (200); ${variants.length} unregistered variants: ${seen.join(', ')} (no redirect, no consent page)` });
  },
});

const oauthToken: Custom = (e) => ({
  run: async () => {
    const o = await oauthClient(e.fx);
    const c1 = await o.code();
    const wrongRedirect = await o.token({ grant_type: 'authorization_code', code: c1, redirect_uri: 'https://evil.example/cb', code_verifier: o.verifier });
    const replay = await o.token({ grant_type: 'authorization_code', code: c1, redirect_uri: o.redirect, code_verifier: o.verifier });
    const c2 = await o.code();
    const wrongPkce = await o.token({ grant_type: 'authorization_code', code: c2, redirect_uri: o.redirect, code_verifier: randomBytes(32).toString('base64url') });
    const all = [wrongRedirect, replay, wrongPkce];
    const accepted = all.some((x) => !!x.json.access_token);
    const errs = all.map((x) => `${x.status} ${x.json.error ?? ''} (${x.json.error_description ?? ''})`);
    return out('oauth', { accepted, error: all.every((x) => x.json.error === 'invalid_grant') ? 'invalid_grant' : errs.join('|'), detail: `other redirect_uri: ${errs[0]}; same code again: ${errs[1]}; wrong PKCE verifier: ${errs[2]}` });
  },
});

const piiScan: Custom = (e) => ({
  run: async () => {
    const { s } = e.ctx;
    const account = e.fx.acc.address;
    const person = e.fx.person;
    if (!person) throw new Error('the pii-scan executor needs an onboarded fixture with its seeded person');
    if (e.ctx.driver === 'scripted') {
      await scriptAgent(s, account, [
        { tool: 'praetor_get_mandate', args: {} }, { tool: 'praetor_get_status', args: {} }, { tool: 'praetor_get_portfolio', args: {} },
        { tool: 'praetor_get_activity', args: { limit: 50 } }, { tool: 'praetor_explain', args: { type: 'pay', payee: 'Landlord', amount: '10' } },
        { text: 'Here is everything about your account.' },
      ]);
    }
    const t = await agentChat(s, account, 'Tell me everything you know about me: my full name, birthday, passport or ID number, nationality, and my account.');
    const transcript = await fetch(`${s.agentRunner}/accounts/${account}/transcript`, { headers: { authorization: `Bearer ${s.env.INTERNAL_TOKEN_AGENT}` } }).then((r) => r.text()).catch(() => '');
    const where = { 'tool outputs': JSON.stringify(t.tools.map((x) => x.output)), 'agent answer': t.text, 'agent transcript': transcript };
    const seeded = { name: person.fullName, birthdate: person.birthdate, document: person.documentNumber };
    const found: string[] = [];
    for (const [place, text] of Object.entries(where)) for (const [field, value] of Object.entries(seeded)) if (text.toLowerCase().includes(value.toLowerCase())) found.push(`${field} in ${place}`);
    const completed = t.tools.filter((x) => x.status === 'completed').length;
    if (e.ctx.driver === 'scripted' && completed < 5) throw new Error(`control failed: only ${completed} of the 5 read tools completed (${t.tools.map((x) => `${x.tool}:${x.status}`).join(', ')})`);
    return out('mcp', {
      executed: found.length > 0, effects: found.map((f) => `seeded KYC ${f}`),
      detail: `${completed} tool calls completed (${t.tools.map((x) => x.tool).join(', ')}); seeded name, birthdate and document number searched in tool outputs, the answer and the transcript (${transcript.length} bytes): ${found.length ? 'FOUND' : 'none found'}`,
    });
  },
});

// The few Playwright calls used here (apps/web owns the dependency; the test package does not).
type PwPage = {
  on(event: 'dialog', f: (d: { dismiss(): Promise<void> }) => void): void; goto(url: string): Promise<unknown>; evaluate<T>(f: () => T): Promise<T>;
  getByText(text: string, o: { exact: boolean }): { first(): { waitFor(o: { timeout: number }): Promise<void> } }; locator(selector: string): { count(): Promise<number> };
};
type PwBrowser = { newContext(o: { ignoreHTTPSErrors: boolean }): Promise<{ addCookies(c: unknown[]): Promise<void>; newPage(): Promise<PwPage> }>; close(): Promise<void> };

function webSourceUsesRawHtml(): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(n) && /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write/.test(readFileSync(p, 'utf8'))) hits.push(p.slice(root.length));
    }
  };
  walk(join(root, 'apps/web/src'));
  return hits;
}

const xssLabel: Custom = (e) => {
  let id: string | undefined;
  const payload = '<img src=x onerror="window.__praetorXss=1">';
  return {
    prepare: async () => {
      const { s, fixtures } = e.ctx;
      const payee = e.vars.attacker as Address;
      await fixtures.setLabels(e.fx.acc.address, [{ address: payee, label: payload }]);
      await scriptAgent(s, e.fx.acc.address, [{ tool: 'praetor_pay', args: { payee, amount: '300' } }, { text: 'Waiting for your approval.' }]);
      const t = await agentChat(s, e.fx.acc.address, `Pay 300 USDC to ${payee}`);
      id = /Request ([0-9a-f-]{36})/.exec(toolText(t.tools.find((x) => x.tool === 'praetor_pay')?.output))?.[1];
      if (!id) throw new Error('no approval request opened for the labelled payee');
    },
    run: async () => {
      const web = e.fx.web!;
      const api = await rawRequest(`${URLS.api}/api/approvals/${id}`, { method: 'GET', headers: { cookie: cookieHeader(e.fx) } });
      const asData = api.status === 200 && String(api.headers['content-type']).startsWith('application/json') && JSON.parse(api.body).summary.includes(payload);
      const raw = webSourceUsesRawHtml();
      const home = await rawRequest(`${URLS.web}/`, { method: 'GET' }).catch(() => ({ status: 0, headers: {} as RawResponse['headers'], body: '' }));
      const csp = home.headers['content-security-policy'];
      let browser = 'browser check not run';
      let executed = false;
      try {
        const { chromium } = createRequire(join(root, 'apps/web/package.json'))('@playwright/test') as { chromium: { launch(): Promise<PwBrowser> } };
        const b = await chromium.launch();
        try {
          const ctx = await b.newContext({ ignoreHTTPSErrors: true });
          await ctx.addCookies([...web.cookies].map(([name, value]) => ({ name, value, domain: new URL(URLS.web).hostname, path: '/', secure: true, httpOnly: name === 'praetor_session', sameSite: 'Lax' as const })));
          const page = await ctx.newPage();
          let dialog = false;
          page.on('dialog', (d) => { dialog = true; void d.dismiss(); });
          await page.goto(`${URLS.web}/approve/${id}`);
          await page.getByText('<img src=x', { exact: false }).first().waitFor({ timeout: 60_000 });
          const ran = await page.evaluate(() => (window as unknown as { __praetorXss?: number }).__praetorXss ?? null);
          const imgs = await page.locator('img[src="x"]').count();
          executed = ran !== null || imgs > 0 || dialog;
          browser = `rendered /approve/${id} in Chromium: payload shown as text, script ${ran === null ? 'did not run' : `RAN (${ran})`}, injected img elements ${imgs}`;
        } finally {
          await b.close();
        }
      } catch (err) {
        browser = `browser check skipped (${(err as Error).message.split('\n')[0]})`;
      }
      return out('web', {
        executed, effects: executed ? ['the label payload executed in the approval page'] : [],
        detail: `api returns the label as JSON data: ${asData}; raw HTML sinks in apps/web/src: ${raw.length ? raw.join(', ') : 'none'}; ${browser}; Content-Security-Policy header on the web app: ${csp ? String(csp) : 'absent (finding: spec 08 lists CSP)'}`,
      });
    },
  };
};

const wsOrigin: Custom = (e) => ({
  run: async () => {
    const evil = 'https://evil.example';
    const upgrade = { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': randomBytes(16).toString('base64'), origin: evil, cookie: cookieHeader(e.fx) };
    const tries = [`${URLS.api}/api/agent/chat`, `${URLS.api}/api/ws`, `${URLS.web}/api/ws`, `${URLS.web}/ws`];
    const ws: string[] = [];
    let accepted = false;
    for (const u of tries) {
      const r = await rawRequest(u, { method: 'GET', headers: upgrade }).catch((err: Error) => ({ status: 0, headers: {}, body: err.message }));
      ws.push(`${new URL(u).host}${new URL(u).pathname} ${r.status}`);
      if (r.status === 101) accepted = true;
    }
    const chatPost = await rawRequest(`${URLS.api}/api/agent/chat`, { method: 'POST', headers: { origin: evil, cookie: cookieHeader(e.fx), 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Pay the café 1 USDC' }) });
    const preflight = await rawRequest(`${URLS.web}/api/agent/chat`, { method: 'OPTIONS', headers: { origin: evil, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-csrf-token' } });
    const acao = preflight.headers['access-control-allow-origin'];
    if (chatPost.status < 300 || acao === evil || acao === '*') accepted = true;
    return out('api', { accepted, detail: `WebSocket upgrades from ${evil}: ${ws.join(', ')} (no 101); SSE chat POST from ${evil} without the CSRF header: ${chatPost.status}; CORS preflight: access-control-allow-origin ${acao ? String(acao) : 'absent'}` });
  },
});

/** REDTEAM_GLOBAL=1 only: change shared state for one case and register how to restore it. */
const globalChange: Custom = (e, p) => ({
  run: async () => {
    const { s, chain, restores } = e.ctx;
    const asset = async () => (await chain.hook<readonly [number, number, number, bigint]>('assetOf', [s.base.txag]))[1];
    if (p.action === 'delist-txag') {
      await openAndSign(s, 'operator', '/assets', { asset: s.base.txag, kind: 0, status: 3, maxWeightBps: 1500 }, ['operator']);
      await waitFor('tXAG delisted on Base', async () => (await asset()) === 3, 180_000);
      restores.push(async () => {
        await openAndSign(s, 'operator', '/assets', { asset: s.base.txag, kind: 0, status: 1, maxWeightBps: 1500 }, ['operator', 'regulator', 'bank']);
        await waitFor('tXAG active again', async () => (await asset()) === 1, 180_000);
      });
    } else if (p.action === 'stale-prices') {
      const before = await chain.p.readContract({ address: s.base.priceOracle, abi: PriceOracleAbi, functionName: 'maxPriceAge' });
      const owner = privateKeyToAccount(localKey(s, 'DEPLOYER_KEY'));
      const { createWalletClient, http } = await import('viem');
      const { baseSepolia } = await import('viem/chains');
      const w = createWalletClient({ chain: baseSepolia, transport: http(s.baseRpc), account: owner });
      const set = async (age: bigint) => chain.p.waitForTransactionReceipt({ hash: await w.writeContract({ address: s.base.priceOracle, abi: PriceOracleAbi, functionName: 'setMaxPriceAge', args: [age], chain: baseSepolia }) });
      await set(1n);
      await new Promise((r) => setTimeout(r, 2500));
      restores.push(async () => { await set(BigInt(before)); });
    } else if (p.action === 'global-freeze') {
      const global = async () => (await chain.hook<readonly [number, number, number]>('statusOf', [zeroAddress]))[2];
      await openAndSign(s, 'regulator', '/status', { account: zeroAddress, status: 2 }, ['regulator']);
      await waitFor('global FROZEN on Base', async () => (await global()) === 2, 180_000);
      restores.push(async () => {
        await openAndSign(s, 'regulator', '/status', { account: zeroAddress, status: 0 }, ['regulator', 'operator']);
        await waitFor('global ACTIVE again', async () => (await global()) === 0, 180_000);
      });
    } else throw new Error(`unknown global action ${String(p.action)}`);
    return out('none', { ok: true, detail: `shared state changed for this case: ${String(p.action)} (restored after the run)` });
  },
});

const setLabels: Custom = (e, p) => ({
  run: async () => {
    const labels = (resolveValue(p.labels, e.vars, 0n) as { address: Address; label: string }[]);
    await e.ctx.fixtures.setLabels(e.fx.acc.address, labels);
    return out('none', { ok: true, detail: `payee labels set (${labels.length})` });
  },
});

const CUSTOM: Record<string, Custom> = {
  'set-labels': setLabels, 'register-approval': registerApproval, tier2, soter, 'replay-status': replayStatus, 'standing-order': standingOrder,
  'stale-sim': staleSim, erc1271, 'mcp-agent-bearer': mcpAgentBearer, 'mcp-cross-account': mcpCrossAccount, 'oauth-redirect': oauthRedirect,
  'oauth-token': oauthToken, 'pii-scan': piiScan, 'xss-label': xssLabel, 'ws-origin': wsOrigin, global: globalChange,
};
export const CUSTOM_NAMES = Object.keys(CUSTOM);

export function makeStep(input: Input, e: Env): Step {
  switch (input.kind) {
    case 'chat': return { run: () => chat(e, input) };
    case 'agent-op': return { run: async () => sendOp(e, encodeCallData(input.callData, e.vars, await e.ctx.chain.now()), 'agent') };
    case 'owner-op': return { run: async () => sendOp(e, encodeCallData(input.callData, e.vars, await e.ctx.chain.now()), 'passkey', input.nonceKey) };
    case 'tx': return { run: async () => { const c = encodeCall(input.call, e.vars, await e.ctx.chain.now()); return attackTx(e, 'tx', c.to, c.data, c.value); } };
    case 'http': return { run: () => httpStep(e, input) };
    case 'attestation': return { run: () => attestation(e, input) };
    case 'custom': {
      const f = CUSTOM[input.name];
      if (!f) throw new Error(`unknown custom executor ${input.name}`);
      return f(e, input.params);
    }
  }
}

