// bank-service (member: bank), governance parts of M5 (spec 05): caps (staff-signed), KYA (bank-signed after its
// checks), the policy check that precedes SET_POLICY, owner-action co-signatures, token identity registration.
// M6: KYC (Demo KYC provider, EUDI wallet), suitability, PersonKYC and AgentMandate on WeIdentity. TEE quote
// verification arrives with M7.
import { z } from 'zod';
import { decodeEventLog, parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseClients, IdentityRegistryAbi } from '@praetor/chain';
import { resolveKey } from '@praetor/config';
import { MandateRegistryAbi } from '@praetor/fisco-client';
import { digest, praetorDomain, POLICY_ABI, type OwnerAction, type Policy } from '@praetor/protocol';
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
import { PasskeyValidatorAbi } from '@praetor/chain';

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

export function startBank(env: Record<string, string | undefined> = process.env) {
  const flags = z.object({
    BASE_RPC_URL: z.string().url(),
    KYA_ALLOW_UNATTESTED: z.enum(['0', '1']).default('0'),
    PRAETOR_ENV: z.string().default('local'),
    KYC_ENC_KEY: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/),
    KYC_VENDOR_HMAC: z.string().min(32),
    WEID_REST_URL: z.string().url().default('http://weid-rest:6001/weid/api/invoke'),
    WEID_HELPER_URL: z.string().url().default('http://weid-helper:6100'),
    EUDI_VERIFIER_BACKEND: z.string().url().optional(),
    EUDI_INTENDED_USE_ID: z.string().default('TEST-01'),
    PUBLIC_HOST: z.string().default('praetor.localhost'),
    PUBLIC_URL: z.string().url().default('https://praetor.localhost'),
  }).parse(env);
  if (flags.PRAETOR_ENV === 'prod' && flags.KYA_ALLOW_UNATTESTED === '1') throw new Error('prod refuses KYA_ALLOW_UNATTESTED=1 (I13)');
  const deskKey = resolveKey('DESK_OPERATOR_KEY', env);
  const bankSignerKey = resolveKey('BANK_BASE_SIGNER_KEY', env);
  const { publicClient, walletClient } = baseClients(flags.BASE_RPC_URL, deskKey);
  const weid = weidClient({ restUrl: flags.WEID_REST_URL, helperUrl: flags.WEID_HELPER_URL });
  let services: { kyc: KycService; mandate: MandateService } | undefined;
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
    services = { kyc, mandate };
    return services;
  };
  return startMember({
    role: 'bank', env, migrations: ['bank'],
    extendPublic: (r, ctx) => kycPublicRoutes(r, { kyc: identityServices(ctx).kyc, vendorHmac: flags.KYC_VENDOR_HMAC }),
    extend: (r, ctx) => {
      routes(r, ctx, { publicClient: publicClient as PublicClient, desk: walletClient as WalletClient, bankSignerKey, allowUnattested: flags.KYA_ALLOW_UNATTESTED === '1' });
      kycRoutes(r, { ...identityServices(ctx), eudi: flags.EUDI_VERIFIER_BACKEND ? { backend: flags.EUDI_VERIFIER_BACKEND } : undefined });
    },
  });
}

type Deps = { publicClient: PublicClient; desk: WalletClient; bankSignerKey: Hex; allowUnattested: boolean };

function routes(r: import('express').Router, ctx: MemberContext, d: Deps) {
  const c = ctx.consortium;
  const mandates = c.address('mandates');

  r.post('/caps', h(async (req, res) => {
    const b = z.object({ riskProfile: z.number().int().min(0).max(3), perTxCap: big, dailyCap: big, monthlyCap: big }).parse(req.body);
    res.json(json({ board: 'mandates', ...(await c.open('mandates', 'openCaps', [b.riskProfile, b.perTxCap, b.dailyCap, b.monthlyCap, await c.deadline()])) }));
  }));

  r.post('/kya', h(async (req, res) => {
    const b = z.object({
      account: address, agentKey: address, agentDidHash: bytes32, kycCredentialHash: bytes32, mandateCredentialHash: bytes32,
      kycLevel: z.number().int().min(0).max(255), riskProfile: z.number().int().min(0).max(3), jurisdiction: z.string().regex(/^[A-Z]{2}$/),
      agentMeasurement: bytes32, validUntil: big, quote: hex.optional(),
    }).parse(req.body);
    // TEE quote verification arrives with M7; until then only a local stack may skip it (refused in prod, I13).
    if (!b.quote && !d.allowUnattested) throw new BadRequest('an attestation quote of the agent signer is required');
    const deadline = await c.deadline();
    const kya = { ...b, jurisdiction: `0x${Buffer.from(b.jurisdiction).toString('hex')}` as Hex, nonce: 0n, deadline, fiscoRef: `0x${'00'.repeat(32)}` as Hex };
    delete (kya as { quote?: Hex }).quote;
    const opened = await c.open('mandates', 'openKYA', [kya]);
    const signed = await c.sign('mandates', opened.proposalId);
    const identityTx = await registerIdentity(d, ctx, b.account, b.kycCredentialHash, b.jurisdiction);
    res.json(json({ board: 'mandates', proposalId: opened.proposalId, ready: signed.ready, identityTx }));
  }));

  r.post('/policy/check', h(async (req, res) => {
    const b = z.object({ account: address, policy: hex, riskProfile: z.number().int().min(0).max(3) }).parse(req.body);
    const { decodeAbiParameters } = await import('viem');
    const [policy] = decodeAbiParameters(POLICY_ABI, b.policy) as unknown as [Policy];
    const receipt = await c.call('mandates', 'submitPolicy', [b.account, policy, b.riskProfile]);
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
  const tx = await d.desk.writeContract({
    address: ctx.base.identityRegistry, abi: IdentityRegistryAbi, functionName: 'registerIdentity',
    args: [account, identityHash, `0x${Buffer.from(country).toString('hex')}` as Hex], account: d.desk.account!, chain: d.desk.chain,
  });
  await d.publicClient.waitForTransactionReceipt({ hash: tx });
  return tx;
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
