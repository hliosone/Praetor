// F6 (spec 06): a payment to a new payee is T2. The refused op lands (evidence), mcp opens an approval request in the
// api, the owner is notified, then approves the exact call with the passkey (web) or SOTER (mini program fixture);
// the api registers the approval on-chain and mcp resubmits the call with the agent key. I5: an approval is used once.
import { describe, it, expect, beforeAll } from 'vitest';
import { erc20Abi, type Address, type Hex } from 'viem';
import { baseNow } from '@praetor/chain';
import { digest, praetorDomain, soterChallenge } from '@praetor/protocol';
import { fakeSoterSignature } from '@praetor/soter-attester';
import {
  activateSoterAttester, agentChat, bootstrapConsortium, ensureDeskLiquidity, fund, labelAddress, linPolicy, pub, scriptAgent, setDemoPrices, stack, waitHeartbeat, type Stack,
} from '../../scripts/demo/lib.js';
import { WebClient, onboardViaApi, policyJson } from '../../scripts/demo/web.js';

let s: Stack;
let web: WebClient;
let agentKey: Address;
const tag = Date.now().toString(36);
const code = `f6-${tag}`;
const ids = { uid: `uid-${tag}`, cpu: `cpu-${tag}` };
const usdc = (a: Address) => pub(s).readContract({ address: s.base.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [a] });
const mp = (path: string, body: unknown) => fetch(`http://10.88.0.80:3200/mp${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
const soter = (raw: string, counter: number) => {
  const resultJSON = JSON.stringify({ raw, counter, uid: ids.uid, cpu_id: ids.cpu });
  return { code, resultJSON, resultJSONSignature: fakeSoterSignature(`openid-of-${code}`, resultJSON), authMode: 'facial' };
};

/** The agent pays a new payee: T2, so mcp opens an approval request; returns its id from the api. */
async function agentPays(payee: Address, amount: string): Promise<string> {
  await scriptAgent(s, web.account!, [
    { tool: 'praetor_pay', args: { payee, amount } },
    { text: 'Waiting for your approval.' },
  ]);
  const t = await agentChat(s, web.account!, `Pay ${amount} USDC to ${payee}`);
  const out = String(t.tools.find((x) => x.tool === 'praetor_pay')?.output);
  expect(out).toMatch(/waiting for the owner/i);
  return /Request ([0-9a-f-]{36})/.exec(out)![1]!;
}

beforeAll(async () => {
  s = stack();
  await bootstrapConsortium(s);
  await setDemoPrices(s);
  await ensureDeskLiquidity(s);
  await activateSoterAttester(s);
  web = new WebClient(s, `f6-${tag}`);
  agentKey = await onboardViaApi(web, `f6-${tag}`, { fullName: `Zqf6person Approve${tag}`, birthdate: '1988-01-02', nationality: 'HK', documentNumber: `F6${tag}` });
  const p = { ...linPolicy(s, 0n), validUntil: (await baseNow(pub(s))) + 31_536_000n };
  const prop = await web.ok('POST', '/api/policy/propose', { policy: policyJson(p) });
  if (!(await web.ownerAction(prop)).success) throw new Error('policy not set');
  await fund(s, { address: web.account!, owner: web.passkey, agent: agentKey });
  // WeChat binding for the SOTER path (F2).
  const start = await web.ok('POST', '/api/wechat/link/start');
  const id = new URL(start.qr).searchParams.get('id')!;
  if ((await mp(`/link/${id}/soter`, soter(soterChallenge(start.digest), 1))) !== 200) throw new Error('link soter');
  if (!(await web.ok('POST', `/api/wechat/link/${id}/confirm`, { assertion: web.assert(start.digest) })).success) throw new Error('link confirm');
  await waitHeartbeat(s);
}, 900_000);

describe('F6 human approval', () => {
  it('1-9 passkey: request with the preimage, digest recomputed by the client, approve, the call executes; notified', async () => {
    const payee = labelAddress(`f6-new-payee-${tag}`);
    const id = await agentPays(payee, '300');
    const r = await web.ok('GET', `/api/approvals/${id}`);
    expect(r.state).toBe('pending');
    // What you see is what you sign: the client recomputes the Tier2Approval digest from the preimage.
    const t2 = { account: r.tier2.account as Address, callHash: r.tier2.callHash as Hex, nonce: BigInt(r.tier2.nonce), expiresAt: BigInt(r.tier2.expiresAt) };
    expect(digest(praetorDomain(s.base.domainName, s.base.mandateHook), 'Tier2Approval', t2)).toBe(r.digest);
    const before = await usdc(payee);
    const out = await web.ok('POST', `/api/approvals/${id}/passkey`, { assertion: web.assert(r.digest) });
    expect(out.state).toBe('executed');
    expect(await usdc(payee)).toBe(before + 300_000_000n);
    const notes = await fetch(`http://10.88.0.81:3210/outbox/${web.account}`, { headers: { authorization: `Bearer ${s.env.INTERNAL_TOKEN_API}` } }).then((x) => x.json());
    expect(JSON.stringify(notes)).toMatch(/Approve\? Pay 300.00 USDC/);
    // I5: the same approval cannot be used again.
    expect((await web.call('POST', `/api/approvals/${id}/passkey`, { assertion: web.assert(r.digest) })).status).toBe(409);
  }, 300_000);

  it('5a-7 SOTER: the mini program approves over the digest with a higher counter; the call executes', async () => {
    const payee = labelAddress(`f6-soter-payee-${tag}`);
    const id = await agentPays(payee, '250');
    const r = await web.ok('GET', `/api/approvals/${id}`);
    const out = await web.ok('POST', `/api/approvals/${id}/soter`, soter(r.soterChallenge, 2));
    expect(out.state).toBe('executed');
    expect(await usdc(payee)).toBe(250_000_000n);
  }, 300_000);

  it('failure: a replayed SOTER counter is refused on-chain (TIER2_INVALID), nothing is paid', async () => {
    const payee = labelAddress(`f6-replay-payee-${tag}`);
    const id = await agentPays(payee, '120');
    const r = await web.ok('GET', `/api/approvals/${id}`);
    const out = await web.call('POST', `/api/approvals/${id}/soter`, soter(r.soterChallenge, 2));
    expect(out.body.state).toBe('failed');
    expect(await usdc(payee)).toBe(0n);
  }, 300_000);
});
