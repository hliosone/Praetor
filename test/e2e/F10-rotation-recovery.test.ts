// F10 (spec 06): agent key rotation and owner recovery through the api, the way the web app drives them, with
// software passkeys. Stop my agent (owner alone) revokes the key on Base and the bank revokes its AgentMandate; a
// rotation creates the next key version in the TEE with its own DID, mandate and KYA (linked to its predecessor on
// FISCO), installed by SET_AGENT_KEY. Recovery: a new passkey for the email, the bank's own re-KYC, the account
// RESTRICTED while pending, any remaining passkey cancels. The 48 h execution is F10-recovery-warp (run last).
import { describe, it, expect, beforeAll } from 'vitest';
import { createPublicClient, encodeFunctionData, erc20Abi, http, keccak256, toHex, type Address, type Hex } from 'viem';
import { MandateHookAbi, baseNow } from '@praetor/chain';
import { OwnerActionKind as K, Reason, softPasskey } from '@praetor/protocol';
import { weidClient } from '@praetor/weid-client';
import { agentOp, bootstrapConsortium, ensureDeskLiquidity, fund, labelAddress, linPolicy, pub, setDemoPrices, stack, waitFor, waitHeartbeat, type Stack } from '../../scripts/demo/lib.js';
import { WebClient, kycMockSubmit, policyJson } from '../../scripts/demo/web.js';

let s: Stack;
let web: WebClient;
const tag = Date.now().toString(36);
const email = `f10-${tag}@example.com`;
const person = { fullName: `Zqften Rotate${tag}`, birthdate: '1987-05-06', nationality: 'HK', documentNumber: `F10${tag}` };
let first: { agentKey: Address; credential: unknown; evidence: Hex };
const hook = <T>(fn: string, args: unknown[]) => pub(s).readContract({ address: s.base.mandateHook, abi: MandateHookAbi, functionName: fn as never, args: args as never }) as Promise<T>;
const agentKeyOnBase = async () => (await hook<readonly [Address]>('kyaOf', [web.account]))[0];
const weid = () => weidClient({ restUrl: 'http://10.89.0.31:6001/weid/api/invoke', helperUrl: 'http://10.89.0.32:6100' });
const SUCCESSOR_TOPIC = keccak256(toHex('SuccessorLinked(address,bytes32,bytes32)'));

/** F1 steps 9 to 14 for the current or the next key: agent (or rotation), mandate signed, KYA on Base, SET_AGENT_KEY. */
async function installAgent(route: '/api/onboarding/agent/create' | '/api/agent/rotate') {
  const agent = await web.ok('POST', route);
  const draft = await web.ok('POST', '/api/onboarding/kya/draft');
  const signed = await web.ok('POST', '/api/onboarding/kya/sign', { draftId: draft.draftId, challenge: draft.challenge, agentDidHash: agent.agentDidHash, assertion: web.assert(draft.challenge) });
  await waitFor('KYA on Base', async () => (await agentKeyOnBase()).toLowerCase() === String(agent.agentKey).toLowerCase(), 180_000);
  const p = await web.ok('POST', '/api/owner-actions/prepare', { kind: K.SET_AGENT_KEY, validUntil: Number((await baseNow(pub(s))) + 7_776_000n) });
  expect((await web.ownerAction(p)).success).toBe(true);
  return { agentKey: agent.agentKey as Address, agentDidHash: agent.agentDidHash as Hex, credential: signed.credential, evidence: signed.mandateCredentialHash as Hex, kya: signed.kya };
}

beforeAll(async () => {
  s = stack();
  await bootstrapConsortium(s);
  await setDemoPrices(s);
  await ensureDeskLiquidity(s);
  web = new WebClient(s, `f10-${tag}`);
  await web.signUp(email);
  const p = await web.ok('POST', '/api/onboarding/account/deploy');
  if (!(await web.ok('POST', '/api/onboarding/account/deploy/submit', { assertion: web.assert(p.userOpHash) })).success) throw new Error('account not deployed');
  const k = await web.ok('POST', '/api/onboarding/kyc/start', { method: 'vendor' });
  await kycMockSubmit(k.redirectUrl, person);
  await waitFor('KYC verified', async () => (await web.ok('GET', '/api/onboarding/kyc/status')).state === 'verified');
  await web.ok('POST', '/api/onboarding/suitability', { answers: [1, 1, 1, 1, 1] });
  first = await installAgent('/api/onboarding/agent/create');
  const pol = await web.ok('POST', '/api/policy/propose', { policy: policyJson({ ...linPolicy(s, 0n), validUntil: (await baseNow(pub(s))) + 31_536_000n }) });
  if (!(await web.ownerAction(pol)).success) throw new Error('policy not set');
  await fund(s, { address: web.account!, owner: web.passkey, agent: first.agentKey });
  await waitHeartbeat(s);
}, 900_000);

const validates = async (agent: Address) => (await agentOp(s, { address: web.account!, owner: web.passkey, agent }, [{ to: s.base.usdc, value: 0n, data: '0x' }])).status === 200;

describe('F10 agent key rotation and owner recovery', () => {
  it('1-2: stop my agent: REVOKE_AGENT_KEY by the owner alone; the key no longer validates; its AgentMandate is revoked', async () => {
    expect(await validates(first.agentKey)).toBe(true);
    expect((await weid().verify(first.credential as never, (first.credential as { issuer: string }).issuer, { evidenceHash: first.evidence })).revoked).toBe(false);
    const p = await web.ok('POST', '/api/owner-actions/prepare', { kind: K.REVOKE_AGENT_KEY });
    expect((await web.ownerAction(p)).success).toBe(true);
    expect(await validates(first.agentKey)).toBe(false);
    await waitFor('mandate revoked', async () => (await weid().verify(first.credential as never, (first.credential as { issuer: string }).issuer, { evidenceHash: first.evidence })).revoked, 60_000);
  }, 300_000);

  it('3-5: rotate: the next key version with its own DID and mandate, its KYA linked to the old one on FISCO; the new key works, the old does not', async () => {
    const next = await installAgent('/api/agent/rotate');
    expect(next.agentKey.toLowerCase()).not.toBe(first.agentKey.toLowerCase());
    const fisco = createPublicClient({ transport: http(process.env.FISCO_RPC_URL_HOST ?? 'http://10.88.1.10:8545') });
    // FISCO computes topics with keccak in the non-SM profile: SuccessorLinked(account, old DID, new DID).
    const receipt = await fisco.getTransactionReceipt({ hash: next.kya.successorTx as Hex });
    const linked = receipt.logs.find((l) => l.topics[0] === SUCCESSOR_TOPIC);
    expect(linked?.data.toLowerCase()).toContain(next.agentDidHash.slice(2).toLowerCase());
    expect(await validates(next.agentKey)).toBe(true);
    expect(await validates(first.agentKey)).toBe(false);
  }, 400_000);

  it('6: recovery: a new passkey for the email and a matching re-KYC schedule it (RESTRICTED); a mismatching one does not; a remaining passkey cancels', async () => {
    const restart = async (who: typeof person) => {
      const fresh = softPasskey(`f10-new-${tag}-${who.documentNumber}`, s.rpId, s.origin);
      const o = await web.ok('POST', '/api/recover/options', { email });
      const v = await web.ok('POST', '/api/recover/verify', { userId: o.userId, response: fresh.registration(o.options.challenge) });
      await kycMockSubmit(v.redirectUrl, who);
      return o.userId as string;
    };
    const userId = await restart({ ...person, documentNumber: `X${tag}` });
    await new Promise((r) => setTimeout(r, 8000));
    expect((await web.ok('GET', `/api/recover/${userId}`)).state).not.toBe('scheduled');
    await restart(person);
    await waitFor('recovery scheduled', async () => (await web.ok('GET', `/api/recover/${userId}`)).state === 'scheduled', 120_000);
    // A7: a pending recovery makes the account RESTRICTED for the agent: even a small payment to a known payee is refused.
    const pay = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [labelAddress('cafe'), 1_000_000n] });
    const r = await agentOp(s, { address: web.account!, owner: web.passkey, agent: await agentKeyOnBase() }, [{ to: s.base.usdc, value: 0n, data: pay }]);
    expect(r.body.success).toBe(false);
    expect(r.body.reasons.map(Number)).toContain(Reason.RESTRICTED);
    const pending = await web.ok('GET', '/api/recovery');
    const p = await web.ok('POST', '/api/owner-actions/prepare', { kind: K.CANCEL_RECOVERY, recoveryPayloadHash: pending.payloadHash });
    expect((await web.ownerAction(p)).success).toBe(true);
    expect((await web.ok('GET', `/api/recover/${userId}`)).state).toBe('cancelled');
  }, 400_000);
});
