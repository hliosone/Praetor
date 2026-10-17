// M11 links: operator audit writer to the FISCO AuditLog (an entry per event, the same chain head on both sides),
// operator + bank anchor through FISCO and the relayer to the Base Anchor contract.
import { describe, it, expect, beforeAll } from 'vitest';
import type { Hex } from 'viem';
import { AnchorAbi } from '@praetor/chain';
import { AuditLogAbi, fiscoClients } from '@praetor/fisco-client';
import { bootstrapConsortium, pub, stack, waitFor, type Stack } from '../../scripts/demo/lib.js';
import { readFileSync } from 'node:fs';

let s: Stack;
const fiscoDeployment = JSON.parse(readFileSync(new URL('../../infra/deployments/fisco-local.json', import.meta.url), 'utf8')) as { auditLog: Hex };
const fisco = fiscoClients('http://10.88.1.10:8545').pub;
const op = (method: string, path: string) =>
  fetch(`${s.members.operator}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${s.env.INTERNAL_TOKEN_MEMBERS}` } });
const fiscoLatest = async () => (await fisco.readContract({ address: fiscoDeployment.auditLog, abi: AuditLogAbi, functionName: 'latest' })) as readonly [bigint, Hex];

beforeAll(async () => { s = stack(); await bootstrapConsortium(s); }, 600_000);

describe('audit writer and anchors', () => {
  it('a heartbeat is audited twice (FISCO Ready, then applied on Base); the stored chain ends on the FISCO head', async () => {
    const [before] = await fiscoLatest();
    const beat = await op('POST', '/heartbeat/beat').then((r) => r.json());
    expect(beat.ready).toBe(true);
    let kinds: string[] = [];
    await waitFor('heartbeat entries', async () => {
      const { entries } = await op('GET', `/audit/entries?from=${Number(before) + 1}`).then((r) => r.json());
      kinds = entries.map((e: { kind: string; reason: string }) => `${e.kind}:${e.reason}`);
      return kinds.includes('HEARTBEAT:READY') && kinds.includes('HEARTBEAT:APPLIED');
    }, 120_000);
    const [seq, head] = await fiscoLatest();
    const { entries } = await op('GET', `/audit/entries?from=${Number(seq)}&limit=1`).then((r) => r.json());
    expect(entries[0]).toMatchObject({ seq: Number(seq), head });
  }, 180_000);

  it('the operator and the bank anchor the head; the relayer delivers it to Base', async () => {
    const [anchorsBefore] = await pub(s).readContract({ address: s.base.anchor, abi: AnchorAbi, functionName: 'latest' });
    let auditSeq = 0;
    await waitFor('anchor opened and co-signed', async () => {
      const r = await op('POST', '/audit/anchor');
      if (r.status !== 200) return false;
      const j = await r.json();
      auditSeq = j.auditSeq;
      return j.ready === true;
    }, 120_000);
    let anchored: Hex = '0x';
    await waitFor('anchored on Base', async () => {
      const [seq, head] = await pub(s).readContract({ address: s.base.anchor, abi: AnchorAbi, functionName: 'latest' });
      anchored = head;
      return seq > anchorsBefore;
    }, 120_000);
    // The anchored head is a head of the FISCO log at or after the seq the operator saw when it opened the anchor.
    const [now] = await fiscoLatest();
    const heads = await Promise.all(Array.from({ length: Number(now) - auditSeq + 1 }, (_, i) => fisco.readContract({ address: fiscoDeployment.auditLog, abi: AuditLogAbi, functionName: 'headAt', args: [BigInt(auditSeq + i)] })));
    expect(heads).toContain(anchored);
  }, 300_000);
});
