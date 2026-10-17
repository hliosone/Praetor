// F1 (spec 06): onboarding through the api the way the web app drives it, with a software passkey in place of Face
// ID (Playwright's virtual authenticator replaces it in M13): passkey, account, KYC (Demo KYC provider), suitability,
// agent key in the TEE with its quote checked by the bank, agent DID, AgentMandate signed with the passkey, KYA, then
// the agent key installed by an owner action. Plus the KYC refusal of a sanctioned person.
import { describe, it, expect, beforeAll } from 'vitest';
import { encodeFunctionData, parseAbi, toHex, type Address, type Hex } from 'viem';
import { IdentityRegistryAbi, MandateHookAbi, baseNow } from '@praetor/chain';
import { OwnerActionKind as K } from '@praetor/protocol';
import { weidClient } from '@praetor/weid-client';
import { agentOp, bootstrapConsortium, ensureDeskLiquidity, fund, labelAddress, pub, setDemoPrices, stack, waitFor, type Stack } from '../../scripts/demo/lib.js';
import { WebClient, kycMockSubmit } from '../../scripts/demo/web.js';

let s: Stack;
let web: WebClient;
const tag = Date.now().toString(36);
const person = { fullName: `Zqf1person Onboard${tag}`, birthdate: '1990-04-02', nationality: 'HK', documentNumber: `F1${tag}` };
let agent: { agentKey: Address; measurement: Hex; agentWeId: string; agentDidHash: Hex };
const hook = (fn: string, args: unknown[]) => pub(s).readContract({ address: s.base.mandateHook, abi: MandateHookAbi, functionName: fn as never, args: args as never });

beforeAll(async () => {
  s = stack();
  await bootstrapConsortium(s);
  await setDemoPrices(s);
  await ensureDeskLiquidity(s);
  web = new WebClient(s, `f1-${tag}`);
}, 600_000);

describe('F1 onboarding through the api', () => {
  it('1-2: sign-up and passkey: the counterfactual account, and a session', async () => {
    const v = await web.signUp(`f1-${tag}@example.com`);
    expect(v.account).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect((await web.ok('GET', '/api/me')).account).toBe(v.account.toLowerCase());
  });

  it('3-4: the first userOp, signed by the passkey, deploys the account with the hook installed (refuses everything: NO_POLICY)', async () => {
    const p = await web.ok('POST', '/api/onboarding/account/deploy');
    expect(p.deployed).toBe(false);
    const r = await web.ok('POST', '/api/onboarding/account/deploy/submit', { assertion: web.assert(p.userOpHash) });
    expect(r.success).toBe(true);
    expect(await pub(s).getCode({ address: web.account! })).not.toBe('0x');
    const [reason] = (await hook('check', [web.account, s.base.usdc, 0n, encodeFunctionData({ abi: parseAbi(['function transfer(address,uint256)']), functionName: 'transfer', args: [labelAddress('cafe'), 1n] })])) as readonly [number];
    expect(reason).not.toBe(0);
  }, 180_000);

  it('5-7: KYC through the Demo KYC provider, then suitability: PersonKYC issued (balanced)', async () => {
    const k = await web.ok('POST', '/api/onboarding/kyc/start', { method: 'vendor' });
    await kycMockSubmit(k.redirectUrl, person);
    expect((await web.ok('GET', '/api/onboarding/kyc/status')).state).toBe('verified');
    const out = await web.ok('POST', '/api/onboarding/suitability', { answers: [1, 1, 1, 1, 1] });
    expect(out).toMatchObject({ state: 'issued', riskProfile: 'balanced' });
  }, 180_000);

  it('8-10: the agent key from the TEE, its quote checked by the bank, the agent DID with AgentWallet and MCP', async () => {
    agent = await web.ok('POST', '/api/onboarding/agent/create');
    expect(agent).toMatchObject({ agentKey: expect.stringMatching(/^0x/), simulator: true });
    const r = (await weidClient({ restUrl: 'http://10.89.0.31:6001/weid/api/invoke', helperUrl: 'http://10.89.0.32:6100' }).getWeIdDocument(agent.agentWeId)) as { weIdDocumentJson: string };
    const services = (JSON.parse(r.weIdDocumentJson) as { service: { type: string; serviceEndpoint: string }[] }).service;
    expect(services.map((x) => [x.type, x.serviceEndpoint])).toEqual(expect.arrayContaining([['AgentWallet', `eip155:84532:${web.account}`], ['MCP', 'https://praetor.localhost/mcp']]));
  }, 180_000);

  it('11-13: the AgentMandate reviewed and signed with the passkey, countersigned; the KYA reaches Base; the identity is registered', async () => {
    const draft = await web.ok('POST', '/api/onboarding/kya/draft');
    expect(draft.claim).toMatchObject({ wallet: `eip155:84532:${web.account}`, agentKey: agent.agentKey, agentMeasurement: agent.measurement, scopes: ['rebalance', 'pay', 'standing_orders'] });
    await web.ok('POST', '/api/onboarding/kya/sign', { draftId: draft.draftId, challenge: draft.challenge, agentDidHash: agent.agentDidHash, assertion: web.assert(draft.challenge) });
    await waitFor('KYA on Base', async () => ((await hook('kyaOf', [web.account])) as readonly [Address])[0].toLowerCase() === agent.agentKey.toLowerCase());
    const [, kycLevel, riskProfile, jurisdiction] = (await hook('kyaOf', [web.account])) as readonly [Address, number, number, Hex];
    expect({ kycLevel, riskProfile, jurisdiction }).toEqual({ kycLevel: 2, riskProfile: 2, jurisdiction: toHex('HK') });
    expect(await pub(s).readContract({ address: s.base.identityRegistry, abi: IdentityRegistryAbi, functionName: 'isVerified', args: [web.account!] })).toBe(true);
  }, 240_000);

  it('14: SET_AGENT_KEY (passkey + bank): the agent key now validates userOps, another key does not', async () => {
    const now = await baseNow(pub(s));
    const p = await web.ok('POST', '/api/owner-actions/prepare', { kind: K.SET_AGENT_KEY, validUntil: Number(now + 7_776_000n) });
    expect((await web.ownerAction(p)).success).toBe(true);
    await fund(s, { address: web.account!, owner: web.passkey, agent: agent.agentKey });
    // Without a policy every agent action is still refused, but it validates (the op lands, refused by the hook, not by validation).
    const r = await agentOp(s, { address: web.account!, owner: web.passkey, agent: agent.agentKey }, [{ to: s.base.usdc, value: 0n, data: '0x' }]);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(false);
  }, 240_000);

  it('failure: a sanctioned person is refused at KYC: no PersonKYC, so no KYA', async () => {
    const bad = new WebClient(s, `f1-bad-${tag}`);
    await bad.signUp(`f1-bad-${tag}@example.com`);
    const k = await bad.ok('POST', '/api/onboarding/kyc/start', { method: 'vendor' });
    await kycMockSubmit(k.redirectUrl, { ...person, fullName: 'Blockedov Ivan' });
    expect(await bad.ok('GET', '/api/onboarding/kyc/status')).toMatchObject({ state: 'rejected', reason: 'sanctions' });
    expect((await bad.call('POST', '/api/onboarding/suitability', { answers: [1, 1, 1, 1, 1] })).status).toBe(409);
  }, 180_000);
});
