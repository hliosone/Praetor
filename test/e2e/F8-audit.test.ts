// F8 (spec 06): audit, anchor, statement. A payment of the agent becomes an audit entry (JSON kept by the operator,
// its hash on the FISCO AuditLog); two members anchor the head on Base through the bridge; /api/audit/verify
// recomputes the chain and agrees with FISCO and the anchor, and finds a tampered entry; the camt.053 statement
// validates against the ISO 20022 schema.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeFunctionData, erc20Abi, type Address, type Hex } from 'viem';
import { AnchorAbi, baseNow } from '@praetor/chain';
import {
  agentOp, bootstrapConsortium, ensureDeskLiquidity, fund, labelAddress, linPolicy, pub, setDemoPrices, stack, waitFor, type Stack,
} from '../../scripts/demo/lib.js';
import { WebClient, onboardViaApi, policyJson } from '../../scripts/demo/web.js';

let s: Stack;
let web: WebClient;
let agentKey: Address;
let payTx: Hex;
let entrySeq: number;
const tag = Date.now().toString(36);
const operator = (method: string, path: string) =>
  fetch(`${s.members.operator}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${s.env.INTERNAL_TOKEN_MEMBERS}` } });
const sql = (q: string) =>
  execFileSync('docker', ['exec', '-e', `MYSQL_PWD=${s.env.MYSQL_PASSWORD_OPERATOR}`, 'praetor-mysql-1', 'mysql', '-uoperator', 'operator', '-N', '-e', q], { encoding: 'utf8' }).trim();

beforeAll(async () => {
  s = stack();
  await bootstrapConsortium(s);
  await setDemoPrices(s);
  await ensureDeskLiquidity(s);
  web = new WebClient(s, `f8-${tag}`);
  agentKey = await onboardViaApi(web, `f8-${tag}`, { fullName: `Zqf8person Audit${tag}`, birthdate: '1985-03-04', nationality: 'HK', documentNumber: `F8${tag}` });
  const p = { ...linPolicy(s, 0n), validUntil: (await baseNow(pub(s))) + 31_536_000n };
  const prop = await web.ok('POST', '/api/policy/propose', { policy: policyJson(p) });
  if (!(await web.ownerAction(prop)).success) throw new Error('policy not set');
  await fund(s, { address: web.account!, owner: web.passkey, agent: agentKey });
}, 900_000);

describe('F8 audit, anchor, statement', () => {
  it('1: an agent payment becomes an audit entry, its hash appended on FISCO', async () => {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [labelAddress('cafe'), 12_500_000n] });
    const r = await agentOp(s, { address: web.account!, owner: web.passkey, agent: agentKey }, [{ to: s.base.usdc, value: 0n, data }]);
    expect(r.body.success).toBe(true);
    payTx = r.body.txHash;
    let entry: { seq: number; kind: string; reason: string; amountUsd6: string; entryHash: Hex } | undefined;
    await waitFor('audit entry of the payment', async () => {
      entry = (await web.ok('GET', '/api/audit')).entries.find((e: { baseTx?: string; kind: string }) => e.baseTx === payTx.toLowerCase() && e.kind === 'DECISION');
      return !!entry;
    }, 120_000);
    expect(entry).toMatchObject({ reason: 'OK', amountUsd6: '12500000' });
    entrySeq = entry!.seq;
    const head = await operator('GET', '/audit/head').then((x) => x.json());
    expect(head.seq).toBeGreaterThanOrEqual(entrySeq);
  }, 300_000);

  it('2-3: two members anchor the head; the bridge delivers it to Base', async () => {
    let anchored: { auditSeq: number } | undefined;
    // The automatic anchor may hold the board for a moment: retry until ours opens.
    await waitFor('anchor opened and co-signed', async () => {
      const r = await operator('POST', '/audit/anchor');
      if (r.status !== 200) return false;
      anchored = await r.json();
      return true;
    }, 120_000);
    expect(anchored!.auditSeq).toBeGreaterThanOrEqual(entrySeq);
    await waitFor('anchor on Base', async () => {
      const v = await web.ok('GET', '/api/audit/verify');
      return v.anchor.auditSeq !== null && v.anchor.auditSeq >= entrySeq;
    }, 120_000);
    const [seq] = await pub(s).readContract({ address: s.base.anchor, abi: AnchorAbi, functionName: 'latest' });
    expect(seq).toBeGreaterThan(0n);
  }, 300_000);

  it('4: verify recomputes the chain: Verified, matching FISCO and the Base anchor', async () => {
    const v = await web.ok('GET', '/api/audit/verify');
    expect(v).toMatchObject({ verified: true, fisco: { match: true }, anchor: { match: true } });
    expect(v.mismatchAt).toBeUndefined();
  }, 120_000);

  it('4: a tampered entry is found: Mismatch at #n; restored, the chain verifies again', async () => {
    const original = sql(`SELECT entry FROM audit_entries WHERE seq = ${entrySeq}`);
    const forged = original.replace('"amountUsd6":"12500000"', '"amountUsd6":"1250000"');
    expect(forged).not.toBe(original);
    const set = (json: string) => sql(`UPDATE audit_entries SET entry = '${json.replace(/'/g, "''")}' WHERE seq = ${entrySeq}`);
    set(forged);
    try {
      expect(await web.ok('GET', '/api/audit/verify')).toMatchObject({ verified: false, mismatchAt: entrySeq });
    } finally {
      set(original);
    }
    expect((await web.ok('GET', '/api/audit/verify')).verified).toBe(true);
  }, 120_000);

  it('5: the camt.053 statement books the payment and validates against the ISO 20022 schema', async () => {
    const r = await fetch(`${process.env.API_URL_HOST ?? 'http://10.88.0.80:3200'}/api/statements/camt053`, { headers: { cookie: [...web.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/xml/);
    const xml = await r.text();
    expect(xml).toContain(`transaction ${payTx.toLowerCase()}`);
    expect(xml).toMatch(/<Amt Ccy="USD">12.50<\/Amt>\s*<CdtDbtInd>DBIT/);
    // An independent check with the system xmllint against the same schema.
    const dir = mkdtempSync(join(tmpdir(), 'f8-'));
    writeFileSync(join(dir, 'statement.xml'), xml);
    const xsd = new URL('../../services/api/assets/camt.053.001.02.xsd', import.meta.url).pathname;
    expect(() => execFileSync('xmllint', ['--noout', '--schema', xsd, join(dir, 'statement.xml')], { stdio: 'pipe' })).not.toThrow();
  }, 120_000);
});
