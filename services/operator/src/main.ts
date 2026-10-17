// operator-service (member: operator): heartbeat job, audit writer and anchor proposer, and the member API (spec 05).
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { encodeAbiParameters, keccak256, type Address, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { resolveKey } from '@praetor/config';
import { ZERO_HASH } from '@praetor/protocol';
import { baseClients, baseNow } from '@praetor/chain';
import { AuditLogAbi } from '@praetor/fisco-client';
import { startMember, type MemberContext } from '@praetor/member-kit';
import { heartbeatOnce, serialized } from './heartbeat.js';
import { AuditWriter, type AuditChain } from './audit.js';
import { MySqlAuditStore } from './audit-store.js';
import { anchorDue, anchorOnce, type OpenAnchor } from './anchor.js';
import { baseEvents, fiscoEvents } from './watch.js';

export function startOperator(env: Record<string, string | undefined> = process.env) {
  const cfg = z.object({
    HEARTBEAT_INTERVAL_S: z.coerce.number().int().positive().default(60),
    HEARTBEAT_TTL_S: z.coerce.number().int().positive().max(86_400).default(180),
    BASE_RPC_URL: z.string().url(),
    FISCO_DEPLOYMENTS_FILE: z.string(),
    BANK_URL: z.string().url().default('http://bank:3020'),
    INTERNAL_TOKEN_MEMBERS: z.string().min(32),
    AUDIT_INTERVAL_S: z.coerce.number().int().positive().default(5),
    // Where the watchers start on their first run: the deployment (prod, a fresh chain) or the current heads.
    AUDIT_FROM: z.enum(['deploy', 'latest']).default('deploy'),
    ANCHOR_EVERY: z.coerce.number().int().positive().default(20),
    ANCHOR_INTERVAL_S: z.coerce.number().int().positive().default(3600),
  }).parse(env);
  const { publicClient } = baseClients(cfg.BASE_RPC_URL);
  const now = () => baseNow(publicClient);
  // The job and a manual beat share one queue: the status board holds one open heartbeat proposal at a time.
  let beat: ((c: MemberContext['consortium']) => ReturnType<typeof heartbeatOnce>) | undefined;
  const beatOnce = (c: MemberContext['consortium']) => (beat ??= serialized((x: MemberContext['consortium']) => heartbeatOnce(x, now, cfg.HEARTBEAT_TTL_S)))(c);
  const fisco = JSON.parse(readFileSync(cfg.FISCO_DEPLOYMENTS_FILE, 'utf8')) as { auditLog: Address; baseOutbox: Address };
  let audit: { store: MySqlAuditStore; writer: AuditWriter; chain: AuditChain } | undefined;
  const anchorState = { anchoredSeq: 0, lastAnchorAt: Date.now(), retryAt: 0 };

  const auditOf = (ctx: MemberContext) => {
    if (audit) return audit;
    const fpub = ctx.consortium.pub;
    const read = (functionName: string, args: readonly unknown[] = []) => fpub.readContract({ address: fisco.auditLog, abi: AuditLogAbi, functionName: functionName as never, args: args as never });
    const chain: AuditChain = {
      latest: async () => { const [seq, head] = (await read('latest')) as readonly [bigint, Hex]; return { seq, head }; },
      headAt: async (seq) => (await read('headAt', [seq])) as Hex,
      append: async (entryHash, kind, account, baseTx, refId) => (await ctx.consortium.call('audit', 'append', [entryHash, kind, account, baseTx, refId])).transactionHash,
    };
    const store = new MySqlAuditStore(ctx.runner);
    audit = { store, writer: new AuditWriter(store, chain), chain };
    return audit;
  };

  /** Bank co-signature of an anchor (it recomputes the head from these entries before signing). */
  const cosign = async (proposalId: bigint) => {
    const r = await fetch(`${cfg.BANK_URL}/audit/anchors/${proposalId}/cosign`, { method: 'POST', headers: { authorization: `Bearer ${cfg.INTERNAL_TOKEN_MEMBERS}` } });
    if (!r.ok) throw new Error(`bank anchor co-signature: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return (await r.json()) as { ready: boolean };
  };

  let bound = false;
  async function tick(ctx: MemberContext) {
    const a = auditOf(ctx);
    if (!bound) {
      await a.store.bindTo(fisco.auditLog);
      bound = true;
    }
    await a.writer.reconcile();
    await a.writer.recover();
    const fpub = ctx.consortium.pub as PublicClient;
    const baseHead = await publicClient.getBlockNumber();
    const fiscoHead = await fpub.getBlockNumber();
    const start = async (name: string, deploy: bigint, head: bigint) => (await a.store.cursor(name)) ?? (cfg.AUDIT_FROM === 'deploy' ? deploy : head + 1n);
    const fromFisco = await start('fisco', 0n, fiscoHead);
    const fromBase = await start('base', BigInt(ctx.base.deployBlock), baseHead);
    const events = [
      ...(fromFisco <= fiscoHead ? await fiscoEvents(fpub, fisco.baseOutbox, fromFisco, fiscoHead) : []),
      ...(fromBase <= baseHead ? await baseEvents(publicClient as PublicClient, ctx.base, fromBase, baseHead) : []),
    ].sort((x, y) => x.atMs - y.atMs);
    await a.writer.record(events);
    await a.store.setCursor('fisco', fiscoHead + 1n);
    await a.store.setCursor('base', baseHead + 1n);
    const { seq } = await a.chain.latest();
    if (Date.now() >= anchorState.retryAt && anchorDue({ auditSeq: Number(seq), anchoredSeq: anchorState.anchoredSeq, lastAnchorAt: anchorState.lastAnchorAt, now: Date.now(), every: cfg.ANCHOR_EVERY, intervalMs: cfg.ANCHOR_INTERVAL_S * 1000 })) {
      // A refused or still-open anchor waits a minute before the next attempt.
      await anchorNow(ctx, Number(seq)).catch((e) => { anchorState.retryAt = Date.now() + 60_000; throw e; });
    }
  }

  // The anchor still open on the audit board, if any: the operator resumes it rather than having openAnchor refused.
  const ANCHOR_KEY = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }], [8, ZERO_HASH]));
  const me = privateKeyToAccount(resolveKey('OPERATOR_BASE_SIGNER_KEY', env)).address.toLowerCase();
  const openAnchor = async (ctx: MemberContext): Promise<OpenAnchor> => {
    const id = (await ctx.consortium.pub.readContract({ address: fisco.auditLog, abi: AuditLogAbi, functionName: 'openProposalOf', args: [ANCHOR_KEY] })) as bigint;
    if (id === 0n) return null;
    const p = (await ctx.consortium.read('audit', id)) as { status: number; deadline: bigint; signers: Address[] };
    if (p.status !== 1 || p.deadline <= BigInt(Math.floor(Date.now() / 1000))) return null;
    return { id, signedByMe: p.signers.some((x) => x.toLowerCase() === me) };
  };

  async function anchorNow(ctx: MemberContext, seq: number) {
    const r = await anchorOnce(ctx.consortium, cosign, () => openAnchor(ctx));
    Object.assign(anchorState, { anchoredSeq: seq, lastAnchorAt: Date.now() });
    ctx.log.info({ proposalId: r.proposalId.toString(), auditSeq: seq, ready: r.ready }, 'anchor proposed');
    return r;
  }

  return startMember({
    role: 'operator',
    env,
    migrations: ['operator'],
    extend: (r, ctx) => {
      r.post('/heartbeat/beat', async (_req, res, next) => {
        try {
          const b = await beatOnce(ctx.consortium);
          res.json({ proposalId: b.proposalId.toString(), ready: b.ready, validUntil: b.validUntil.toString() });
        } catch (e) {
          next(e);
        }
      });
      // The audit entries (JSON) anyone with the internal token can recompute; the api and the bank read them.
      r.get('/audit/entries', async (req, res, next) => {
        try {
          const q = z.object({ from: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(1000).default(500), account: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional() }).parse(req.query);
          const rows = await auditOf(ctx).store.list(q.from, q.limit, q.account);
          res.json({ entries: rows.filter((x) => x.state === 'appended').map((x) => x.entry) });
        } catch (e) {
          next(e);
        }
      });
      r.get('/audit/head', async (_req, res, next) => {
        try {
          const { seq, head } = await auditOf(ctx).chain.latest();
          res.json({ seq: Number(seq), head });
        } catch (e) {
          next(e);
        }
      });
      // On demand (demo, tests): anchor the current head now.
      r.post('/audit/anchor', async (_req, res, next) => {
        try {
          const { seq } = await auditOf(ctx).chain.latest();
          const out = await anchorNow(ctx, Number(seq));
          res.json({ proposalId: out.proposalId.toString(), ready: out.ready, auditSeq: Number(seq) });
        } catch (e) {
          next(e);
        }
      });
    },
    jobs: (ctx) => {
      let beating = false;
      const hb = setInterval(() => {
        if (beating) return;
        beating = true;
        beatOnce(ctx.consortium)
          .then((b) => ctx.log.info({ proposalId: b.proposalId.toString(), validUntil: b.validUntil.toString() }, 'heartbeat'))
          .catch((e) => ctx.log.warn({ error: (e as Error).message.split('\n')[0] }, 'heartbeat failed'))
          .finally(() => { beating = false; });
      }, cfg.HEARTBEAT_INTERVAL_S * 1000);
      let auditing = false;
      const au = setInterval(() => {
        if (auditing) return;
        auditing = true;
        tick(ctx)
          .catch((e) => ctx.log.warn({ error: (e as Error).message.split('\n')[0] }, 'audit tick failed'))
          .finally(() => { auditing = false; });
      }, cfg.AUDIT_INTERVAL_S * 1000);
      return () => { clearInterval(hb); clearInterval(au); };
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startOperator().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
