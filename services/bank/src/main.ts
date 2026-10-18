// bank-service (member: bank), governance parts of M5 (spec 05): caps (staff-signed), KYA (bank-signed after its
// checks), the policy check that precedes SET_POLICY, owner-action co-signatures, token identity registration.
// M6: KYC (Demo KYC provider, EUDI wallet), suitability, PersonKYC and AgentMandate on WeIdentity. TEE quote
// verification arrives with M7.
import { z } from 'zod';
import { decodeEventLog, getAddress, parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseClients, IdentityRegistryAbi } from '@praetor/chain';
import { resolveKey } from '@praetor/config';
import { MandateRegistryAbi, oneAtATime } from '@praetor/fisco-client';
import { digest, praetorDomain, POLICY_ABI, ZERO_HASH, type AuditEntry, type OwnerAction, type Policy } from '@praetor/protocol';
import { startMember, type MemberContext } from '@praetor/member-kit';
import type { Request, Response, NextFunction } from 'express';
import { weidClient } from '@praetor/weid-client';
import { checkCosign, type CosignReaders } from './cosign.js';
import { KycService } from './kyc.js';
import { MandateService } from './mandate.js';
import { kycPublicRoutes, kycRoutes } from './kyc-routes.js';
import { ensureBankIdentity, memoIdentity } from './identity.js';
import { MySqlKv, MySqlKycStore, MySqlMandateStore } from './stores.js';
import { MOCK_SANCTIONS } from './sanctions-mock.js';
import { NonceBook, phalaVerifier, verifyTeeQuote, type PhalaVerifier } from './attestation.js';
import { AttesterChecks } from './attesters.js';
import { KyaBuilder } from './kya.js';
import { createAgentDid } from './agent-did.js';
import { checkAnchor } from './anchor-guard.js';
import { signCaller } from '@praetor/protocol/caller-auth';
import { AgentKeyValidatorAbi, MandateHookAbi, PasskeyValidatorAbi } from '@praetor/chain';
import { RecoveryService } from './recovery.js';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s as Address);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((s) => s as Hex);
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/).transform((s) => s as Hex);
const big = z.union([z.string().regex(/^(0x[0-9a-fA-F]+|\d+)$/), z.number().int()]).transform((v) => BigInt(v));
const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

class BadRequest extends Error {
  status = 400;
}

/** Configuration and its I13 rule: prod never accepts simulator quotes (a KYA always needs a verified quote). */
export function bankFlags(env: Record<string, string | undefined>) {
  const f = z.object({
    BASE_RPC_URL: z.string().url(),
    PRAETOR_ENV: z.string().default('local'),
    KYC_ENC_KEY: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/),
    KYC_VENDOR_HMAC: z.string().min(32),
    WEID_REST_URL: z.string().url().default('http://weid-rest:6001/weid/api/invoke'),
    WEID_HELPER_URL: z.string().url().default('http://weid-helper:6100'),
    EUDI_VERIFIER_BACKEND: z.string().url().optional(),
    EUDI_INTENDED_USE_ID: z.string().default('TEST-01'),
    PUBLIC_HOST: z.string().default('praetor.localhost'),
    PUBLIC_URL: z.string().url().default('https://praetor.localhost'),
    ATTESTATION_MODE: z.enum(['simulator', 'phala']).default('phala'),
    ALLOWED_COMPOSE_HASHES_AGENT: z.string().default(''),
    ALLOWED_COMPOSE_HASHES_ATTESTER: z.string().default(''),
    AGENT_SIGNER_URL: z.string().url().default('http://agent-signer:3050'),
    SIGNER_HMAC_BANK: z.string().min(32).optional(),
    OPERATOR_URL: z.string().url().default('http://operator:3020'),
    INTERNAL_TOKEN_MEMBERS: z.string().min(32).optional(),
  }).parse(env);
  if (f.PRAETOR_ENV === 'prod' && f.ATTESTATION_MODE === 'simulator') throw new Error('prod refuses simulator attestations (I13)');
  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
  const allowedAgent = list(f.ALLOWED_COMPOSE_HASHES_AGENT);
  if (f.ATTESTATION_MODE === 'phala' && allowedAgent.length === 0) throw new Error('ATTESTATION_MODE=phala needs a compose-hash allowlist');
  return { ...f, allowedAgent, allowedAttester: list(f.ALLOWED_COMPOSE_HASHES_ATTESTER) };
}

export function startBank(env: Record<string, string | undefined> = process.env) {
  const flags = bankFlags(env);
  const deskKey = resolveKey('DESK_OPERATOR_KEY', env);
  const bankSignerKey = resolveKey('BANK_BASE_SIGNER_KEY', env);
  const { publicClient, walletClient } = baseClients(flags.BASE_RPC_URL, deskKey);
  const weid = weidClient({ restUrl: flags.WEID_REST_URL, helperUrl: flags.WEID_HELPER_URL });
  const nonces = new NonceBook();
  const verifier = flags.ATTESTATION_MODE === 'phala' ? phalaVerifier() : undefined;
  const attesters = new AttesterChecks({ nonces, mode: flags.ATTESTATION_MODE, allowed: flags.allowedAttester, verifier });
  let services: { kyc: KycService; mandate: MandateService; kya: KyaBuilder; agentDid: (account: string, keyVersion: number) => Promise<{ agentWeId: string; agentDidHash: Hex }> } | undefined;
  const identityServices = (ctx: MemberContext) => {
    if (services) return services;
    const identity = memoIdentity(() => ensureBankIdentity(weid, new MySqlKv(ctx.runner)));
    const kyc = new KycService({
      store: new MySqlKycStore(ctx.runner), weid, encKey: flags.KYC_ENC_KEY.replace(/^0x/, ''), sanctions: MOCK_SANCTIONS, identity,
      publicUrl: flags.PUBLIC_URL, eudi: { backend: flags.EUDI_VERIFIER_BACKEND ?? '', intendedUseId: flags.EUDI_INTENDED_USE_ID },
    });
    const mandate = new MandateService({
      store: new MySqlMandateStore(ctx.runner), kycRecord: (u) => kyc.record(u), identity, weid, rpId: flags.PUBLIC_HOST, origin: flags.PUBLIC_URL,
      passkeyOf: async (account, credIdHash) => {
        const [x, y] = (await publicClient.readContract({ address: ctx.base.passkeyValidator, abi: PasskeyValidatorAbi, functionName: 'ownerKey', args: [account as Address, credIdHash] })) as readonly [bigint, bigint];
        return x === 0n && y === 0n ? null : { x, y };
      },
    });
    const kya = new KyaBuilder({ recordOf: (a) => kyc.recordByAccount(a) });
    const signer = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
      if (!flags.SIGNER_HMAC_BANK) throw new Error('SIGNER_HMAC_BANK missing');
      const raw = body === undefined ? '' : JSON.stringify(body);
      const r = await fetch(`${flags.AGENT_SIGNER_URL}${path}`, { method, body: raw || undefined, headers: { 'content-type': 'application/json', ...signCaller('bank', flags.SIGNER_HMAC_BANK, method, path, Buffer.from(raw)) }, signal: AbortSignal.timeout(20_000) });
      const j = (await r.json().catch(() => ({}))) as Record<string, any>;
      if (!r.ok) throw new Error(`agent-signer ${path}: ${r.status} ${j.error ?? ''}`);
      return j;
    };
    const fisco = ctx.consortium.pub;
    const WEID_ABI = parseAbi(['function isIdentityExist(address identity) view returns (bool)', 'function resolve(address identity) view returns (string created, string updated, bool deactivated, uint16 versionId, string[] authentication, string[] service)']);
    let weIdContract: Address | undefined;
    const contract = async () => (weIdContract ??= (await weid.contracts()).weId as Address);
    // A rotated agent key (F10) is a new key version in agent-signer, with its own WeID.
    const agentDid = (account: string, keyVersion: number) => createAgentDid({
      signer: {
        createDid: async (a) => (await signer('POST', `/v1/agents/${a}/sign-weid`, { kind: 'createDid', keyVersion, fields: {} })) as { address: Address; publicKeyECDSA: string },
        addService: async (a, fields) => (await signer('POST', `/v1/agents/${a}/sign-weid`, { kind: 'addService', keyVersion, fields })) as { rawTx: Hex },
      },
      weid: { createWeIdWithPubKey: (p) => weid.createWeIdWithPubKey(p), contracts: weid.contracts },
      fisco: {
        exists: async (agent) => (await fisco.readContract({ address: await contract(), abi: WEID_ABI, functionName: 'isIdentityExist', args: [agent] })) as boolean,
        resolve: async (agent) => {
          const r = (await fisco.readContract({ address: await contract(), abi: WEID_ABI, functionName: 'resolve', args: [agent] })) as readonly [string, string, boolean, number, readonly string[], readonly string[]];
          return { authentication: [...r[4]], service: [...r[5]] };
        },
        nonce: (agent) => fisco.getTransactionCount({ address: agent }),
        sendRaw: async (rawTx) => fisco.waitForTransactionReceipt({ hash: await fisco.sendRawTransaction({ serializedTransaction: rawTx }) }),
      },
      mcpUrl: `${flags.PUBLIC_URL.replace(/\/$/, '')}/mcp`,
    }, account);
    services = { kyc, mandate, kya, agentDid };
    return services;
  };
  // The operator's audit entries, all of them, for the anchor check (second member).
  const auditEntries = async () => {
    const out: AuditEntry[] = [];
    for (let from = 1; ; ) {
      const r = await fetch(`${flags.OPERATOR_URL}/audit/entries?from=${from}&limit=1000`, { headers: { authorization: `Bearer ${flags.INTERNAL_TOKEN_MEMBERS}` }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`operator audit entries: ${r.status}`);
      const page = ((await r.json()) as { entries: AuditEntry[] }).entries;
      out.push(...page);
      if (page.length < 1000) return out;
      from = page.at(-1)!.seq + 1;
    }
  };
  const anchorOf = (m: unknown) => m as { seq: bigint; head: Hex; fiscoBlock: bigint; deadline: bigint };
  // The bank's recovery transactions go out from its desk account; the notice is its own channel (D13: a log sink).
  const recovery = (ctx: MemberContext) => new RecoveryService({
    domain: { name: ctx.base.domainName, hook: ctx.base.mandateHook }, bankSignerKey,
    now: async () => (await publicClient.getBlock()).timestamp,
    schedule: async (a, payload, bankSigs) => {
      if (!walletClient) throw new Error('DESK_OPERATOR_KEY missing: the bank cannot send the recovery');
      return oneAtATime(walletClient.account!.address, async () => {
        const hash = await walletClient.writeContract({ address: ctx.base.mandateHook, abi: MandateHookAbi, functionName: 'scheduleRecovery', args: [a, payload, bankSigs], account: walletClient.account!, chain: walletClient.chain });
        if ((await publicClient.waitForTransactionReceipt({ hash })).status !== 'success') throw new Error('scheduleRecovery reverted');
        return hash;
      });
    },
    notify: async (account, text) => { console.log(JSON.stringify({ channel: 'bank-notice', account, text })); },
  });
  return startMember({
    role: 'bank', env, migrations: ['bank'],
    signGuards: () => ({ attesters: (m) => attesters.guard(m), audit: async (m) => { await checkAnchor(anchorOf(m), auditEntries); } }),
    extendPublic: (r, ctx) => kycPublicRoutes(r, {
      kyc: identityServices(ctx).kyc, vendorHmac: flags.KYC_VENDOR_HMAC,
      onRecoveryMatch: async (account, key) => { await recovery(ctx).schedule(account as Address, key); },
    }),
    extend: (r, ctx) => {
      routes(r, ctx, {
        publicClient: publicClient as PublicClient, desk: walletClient as WalletClient, bankSignerKey,
        attest: { mode: flags.ATTESTATION_MODE, allowedAgent: flags.allowedAgent, nonces, verifier },
        kya: identityServices(ctx).kya, agentDid: identityServices(ctx).agentDid,
      });
      r.post('/attesters/nonce', h(async (req, res) => {
        res.json({ nonce: attesters.nonce(address.parse(req.body?.attester)) });
      }));
      r.post('/attesters/verify', h(async (req, res) => {
        const b = z.object({ attester: address, nonce: bytes32, quote: z.string().regex(/^(0x)?[0-9a-fA-F]+$/).max(40_000) }).parse(req.body);
        res.json(await attesters.verify(b.attester, b.nonce, b.quote));
      }));
      // The operator's request for the second signature of an anchor (automated, like the heartbeat, D24).
      r.post('/audit/anchors/:id/cosign', h(async (req, res) => {
        const id = BigInt(z.string().regex(/^\d+$/).parse(req.params.id));
        const p = await ctx.consortium.read('audit', id);
        const auditSeq = await checkAnchor(anchorOf(p.message), auditEntries);
        const { ready } = await ctx.consortium.sign('audit', id);
        res.json({ ready, auditSeq });
      }));
      kycRoutes(r, {
        kyc: identityServices(ctx).kyc, mandate: identityServices(ctx).mandate, kya: identityServices(ctx).kya, eudi: flags.EUDI_VERIFIER_BACKEND ? { backend: flags.EUDI_VERIFIER_BACKEND } : undefined,
        agentOf: async (account) => {
          const [key, , revoked] = (await publicClient.readContract({ address: ctx.base.agentKeyValidator, abi: AgentKeyValidatorAbi, functionName: 'agentOf', args: [account as Address] })) as readonly [Address, number, boolean];
          return { key, revoked };
        },
      });
    },
  });
}

type Deps = {
  publicClient: PublicClient; desk: WalletClient; bankSignerKey: Hex;
  attest: { mode: 'simulator' | 'phala'; allowedAgent: string[]; nonces: NonceBook; verifier?: PhalaVerifier };
  kya: KyaBuilder;
  agentDid(account: string, keyVersion: number): Promise<{ agentWeId: string; agentDidHash: Hex }>;
};

function routes(r: import('express').Router, ctx: MemberContext, d: Deps) {
  const c = ctx.consortium;
  const mandates = c.address('mandates');

  r.post('/caps', h(async (req, res) => {
    const b = z.object({ riskProfile: z.number().int().min(0).max(3), perTxCap: big, dailyCap: big, monthlyCap: big }).parse(req.body);
    res.json(json({ board: 'mandates', ...(await c.open('mandates', 'openCaps', [b.riskProfile, b.perTxCap, b.dailyCap, b.monthlyCap, await c.deadline()])) }));
  }));

  // A fresh nonce per KYA: the agent-signer quote must bind the agent key to it (keccak256(agentKey || nonce)).
  r.post('/kya/nonce', h(async (req, res) => {
    const b = z.object({ account: address }).parse(req.body);
    res.json({ nonce: d.attest.nonces.issue(b.account) });
  }));

  // F1 step 9: the agent-signer quote binds the agent key to a bank nonce; the bank keeps the key and measurement.
  r.post('/kya/verify', h(async (req, res) => {
    const b = z.object({ account: address, agentKey: address, quote: z.string().regex(/^(0x)?[0-9a-fA-F]+$/).max(40_000), nonce: bytes32 }).parse(req.body);
    if (!d.attest.nonces.consume(b.account, b.nonce)) throw new BadRequest('unknown, used or expired KYA nonce');
    let measurement: Hex;
    try {
      measurement = (await verifyTeeQuote({ quote: b.quote, address: b.agentKey, nonce: b.nonce, mode: d.attest.mode, allowed: d.attest.allowedAgent, verifier: d.attest.verifier })).measurement;
    } catch (e) {
      throw new BadRequest(`agent-signer quote refused: ${(e as Error).message}`);
    }
    d.kya.quoteVerified(b.account, b.agentKey, measurement);
    res.json({ agentKey: b.agentKey, measurement });
  }));

  // F1 step 10: the agent's WeID with its AgentWallet and MCP services, signed inside agent-signer.
  r.post('/kya/agent-did', h(async (req, res) => {
    const b = z.object({ account: address, keyVersion: z.number().int().min(1).max(16).default(1) }).parse(req.body);
    res.json(await d.agentDid(b.account, b.keyVersion));
  }));

  // F1 step 12: the KYA attestation from what the bank verified itself (KYC record, quote, countersigned mandate).
  r.post('/kya', h(async (req, res) => {
    const b = z.object({ account: address, agentDidHash: bytes32, validUntil: big }).parse(req.body);
    const k = await d.kya.build(b.account, { agentDidHash: b.agentDidHash, validUntil: b.validUntil });
    const deadline = await c.deadline();
    const kya = { ...k, agentKey: getAddress(k.agentKey), jurisdiction: `0x${Buffer.from(k.jurisdiction).toString('hex')}` as Hex, nonce: 0n, deadline, fiscoRef: `0x${'00'.repeat(32)}` as Hex };
    // F10 step 4: a KYA that replaces another agent links the two agent DIDs on FISCO (MandateRegistry.SuccessorLinked).
    const previous = ((await c.pub.readContract({ address: mandates, abi: MandateRegistryAbi, functionName: 'kyaOf', args: [b.account] })) as { agentDidHash: Hex }).agentDidHash;
    const opened = await c.open('mandates', 'openKYA', [kya]);
    const signed = await c.sign('mandates', opened.proposalId);
    const successorTx = previous !== ZERO_HASH && previous.toLowerCase() !== b.agentDidHash.toLowerCase()
      ? (await c.call('mandates', 'linkSuccessor', [b.account, previous, b.agentDidHash])).transactionHash : null;
    const identityTx = await registerIdentity(d, ctx, b.account, k.kycCredentialHash, k.jurisdiction);
    res.json(json({ board: 'mandates', proposalId: opened.proposalId, ready: signed.ready, identityTx, successorTx, kya: { kycLevel: k.kycLevel, riskProfile: k.riskProfile, jurisdiction: k.jurisdiction } }));
  }));

  r.post('/policy/check', h(async (req, res) => {
    const b = z.object({ account: address, policy: hex }).parse(req.body);
    const { decodeAbiParameters } = await import('viem');
    const [policy] = decodeAbiParameters(POLICY_ABI, b.policy) as unknown as [Policy];
    // The caps of the risk profile the bank recorded in this account's KYA, never one the caller names.
    const kya = (await c.pub.readContract({ address: mandates, abi: MandateRegistryAbi, functionName: 'kyaOf', args: [b.account] })) as { riskProfile: number; agentKey: Address };
    if (kya.agentKey === '0x0000000000000000000000000000000000000000') throw new BadRequest('no KYA for this account');
    const receipt = await c.call('mandates', 'submitPolicy', [b.account, policy, kya.riskProfile]);
    const ev = mandateCheckedIn(receipt.logs, mandates);
    if (!ev) throw new Error('no MandateChecked event');
    res.json(json({ ...ev, fiscoRef: receipt.transactionHash }));
  }));

  r.post('/owner-actions/cosign', h(async (req, res) => {
    const b = z.object({
      ownerAction: z.object({ account: address, action: z.number().int(), payloadHash: bytes32, nonce: big, expiresAt: big, fiscoRef: bytes32 }),
      payload: hex,
    }).parse(req.body);
    const a = b.ownerAction as OwnerAction;
    await checkCosign(a, b.payload, readers(ctx, mandates));
    const h2 = digest(praetorDomain(ctx.base.domainName, ctx.base.mandateHook), 'OwnerAction', a);
    const bankSig = await privateKeyToAccount(d.bankSignerKey).sign({ hash: h2 });
    const record = await c.call('mandates', 'recordOwnerAction', [a.account, a.action, a.payloadHash, h2]);
    res.json({ bankSig, digest: h2, recordTx: record.transactionHash });
  }));

  r.post('/identity/register', h(async (req, res) => {
    const b = z.object({ account: address, kycCredentialHash: bytes32, country: z.string().regex(/^[A-Z]{2}$/) }).parse(req.body);
    res.json({ identityTx: await registerIdentity(d, ctx, b.account, b.kycCredentialHash, b.country) });
  }));
}

async function registerIdentity(d: Deps, ctx: MemberContext, account: Address, identityHash: Hex, country: string): Promise<Hex | null> {
  const verified = await d.publicClient.readContract({ address: ctx.base.identityRegistry, abi: IdentityRegistryAbi, functionName: 'isVerified', args: [account] });
  if (verified) return null;
  // Parallel onboardings send from the same desk account: one at a time, or two read the same nonce.
  return oneAtATime(d.desk.account!.address, async () => {
    const tx = await d.desk.writeContract({
      address: ctx.base.identityRegistry, abi: IdentityRegistryAbi, functionName: 'registerIdentity',
      args: [account, identityHash, `0x${Buffer.from(country).toString('hex')}` as Hex], account: d.desk.account!, chain: d.desk.chain,
    });
    await d.publicClient.waitForTransactionReceipt({ hash: tx });
    return tx;
  });
}

function mandateCheckedIn(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], at: Address) {
  for (const l of logs) {
    if (l.address.toLowerCase() !== at.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: MandateRegistryAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      if (ev.eventName === 'MandateChecked') return ev.args as unknown as { account: Address; policyHash: Hex; ok: boolean; failedRule: number };
    } catch {
      // other events
    }
  }
  return null;
}

function readers(ctx: MemberContext, mandates: Address): CosignReaders {
  const c = ctx.consortium;
  const capsAbi = parseAbi(['function capsOf(uint8) view returns (uint256 perTxCap, uint256 dailyCap, uint256 monthlyCap)']);
  return {
    mandateChecked: async (fiscoTx) => {
      const receipt = await c.pub.getTransactionReceipt({ hash: fiscoTx }).catch(() => null);
      return receipt ? mandateCheckedIn(receipt.logs, mandates) : null;
    },
    kyaAgentKey: async (account) => ((await c.pub.readContract({ address: mandates, abi: MandateRegistryAbi, functionName: 'kyaOf', args: [account] })) as { agentKey: Address }).agentKey,
    perTxCap: async (account) => {
      const k = (await c.pub.readContract({ address: mandates, abi: MandateRegistryAbi, functionName: 'kyaOf', args: [account] })) as { riskProfile: number };
      const [perTx] = (await c.pub.readContract({ address: mandates, abi: capsAbi, functionName: 'capsOf', args: [k.riskProfile] })) as readonly [bigint, bigint, bigint];
      return perTx;
    },
    modules: { passkeyValidator: ctx.base.passkeyValidator, agentKeyValidator: ctx.base.agentKeyValidator, standingOrders: ctx.base.standingOrders, mandateHook: ctx.base.mandateHook },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startBank().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
