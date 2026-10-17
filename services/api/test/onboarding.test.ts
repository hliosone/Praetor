import { describe, it, expect } from 'vitest';
import { decodeAbiParameters, type Address, type Hex } from 'viem';
import { softPasskey, WEBAUTHN_AUTH_TUPLE } from '@praetor/protocol';
import { Onboarding, type OnboardingDeps } from '../src/onboarding.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as Address;
const AGENT = '0x00000000000000000000000000000000000a6e47' as Address;
const pk = softPasskey('onboarding', 'praetor.localhost', 'https://praetor.localhost');
const b64 = (h: Hex) => Buffer.from(h.slice(2), 'hex').toString('base64url');
const HASH = `0x${'77'.repeat(32)}` as Hex;

function setup(deployed = false) {
  const calls: string[] = [];
  const sent: Record<string, unknown>[] = [];
  // A fake of the internal clients (typed loosely: only what Onboarding calls).
  const c: any = {};
  const d: OnboardingDeps = {
    user: async () => ({ userId: 'u1', account: ACCOUNT, credIdHash: pk.credIdHash }),
    credIdHashOf: async () => pk.credIdHash,
    isDeployed: async () => deployed,
    firstOp: async () => ({ factory: '0x00000000000000000000000000000000000000fa' as Address, factoryData: '0x12' as Hex, callData: '0x34' as Hex }),
    now: async () => 1_800_000_000n,
    c: Object.assign(c, {
      bundler: {
        register: async () => { calls.push('register'); },
        prepare: async (b: any) => { calls.push(`prepare:${b.validator}`); return { userOp: { sender: ACCOUNT }, userOpHash: HASH }; },
        send: async (op: any) => { sent.push(op); return { userOpHash: HASH, txHash: HASH, success: true, reasons: [], refusalLogTx: null }; },
      },
      bank: {
        kycStart: async (ref: any, acc: any, m: any) => { calls.push(`kycStart:${ref}:${acc}:${m}`); return { sessionId: 's1', redirectUrl: 'https://x/kyc-mock/?session=s1' }; },
        kycStatus: async () => ({ state: 'issued' }),
        suitability: async () => ({ state: 'issued', riskProfile: 'balanced' }),
        kyaNonce: async () => { calls.push('nonce'); return { nonce: HASH }; },
        kyaVerify: async () => { calls.push('verify'); return { agentKey: AGENT, measurement: HASH }; },
        agentDid: async () => { calls.push('did'); return { agentWeId: `did:weid:101:${AGENT}`, agentDidHash: HASH }; },
        mandatePrepare: async (b: any) => { calls.push(`prepare-mandate:${b.agentKey}`); return { draftId: 'd1', challenge: HASH, claim: { agentKey: AGENT } }; },
        mandateSign: async (id: any, a: any) => { calls.push(`sign-mandate:${id}:${(a as { credentialId: Hex }).credentialId}`); return { mandateCredentialHash: HASH }; },
        kya: async (b: any) => { calls.push(`kya:${b.agentDidHash}`); return { ready: true }; },
      },
      signer: {
        address: async () => ({ address: AGENT }),
        attest: async () => { calls.push('attest'); return { address: AGENT, quote: 'q' }; },
        info: async () => ({ simulator: true, composeHash: 'c' }),
      },
    }),
  };
  return { o: new Onboarding(d), calls, sent };
}

describe('F1 through the api', () => {
  it('3-4: prepares the first (launchpad) userOp, then submits it with the passkey signature over its hash', async () => {
    const { o, calls, sent } = setup();
    const p = await o.deployPrepare(ACCOUNT);
    expect(p).toEqual({ deployed: false, userOpHash: HASH });
    expect(calls).toEqual(['register', 'prepare:passkey']);
    const r = await o.deploySubmit(ACCOUNT, pk.authentication(b64(HASH)));
    expect(r.success).toBe(true);
    const [cred, auth] = decodeAbiParameters([{ type: 'bytes32' }, WEBAUTHN_AUTH_TUPLE], sent[0]!.signature as Hex);
    expect(cred).toBe(pk.credIdHash);
    expect(auth.clientDataJSON).toContain(b64(HASH));
  });

  it('an account already deployed needs no first op', async () => {
    const { o } = setup(true);
    expect(await o.deployPrepare(ACCOUNT)).toEqual({ deployed: true });
  });

  it('5: KYC starts at the bank for this user and account', async () => {
    const { o, calls } = setup();
    expect((await o.kycStart(ACCOUNT, 'vendor')).redirectUrl).toMatch(/kyc-mock/);
    expect(calls).toEqual([`kycStart:u1:${ACCOUNT}:vendor`]);
  });

  it('8-10: the agent key from the TEE, its quote checked by the bank, then its DID', async () => {
    const { o, calls } = setup();
    expect(await o.agentCreate(ACCOUNT)).toMatchObject({ agentKey: AGENT, measurement: HASH, agentWeId: `did:weid:101:${AGENT}`, simulator: true });
    expect(calls).toEqual(['nonce', 'attest', 'verify', 'did']);
  });

  it('11-12: the mandate draft, the owner passkey over its challenge, then the KYA', async () => {
    const { o, calls } = setup();
    const draft = await o.mandateDraft(ACCOUNT);
    expect(draft.challenge).toBe(HASH);
    await o.mandateSign(ACCOUNT, { draftId: draft.draftId, challenge: draft.challenge, agentDidHash: HASH, assertion: pk.authentication(b64(HASH)) });
    expect(calls).toEqual([`prepare-mandate:${AGENT}`, `sign-mandate:d1:${pk.credIdHash}`, `kya:${HASH}`]);
  });
});
