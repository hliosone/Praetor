import { describe, it, expect, beforeEach } from 'vitest';
import { toHex, type Hex } from 'viem';
import { softPasskey } from '@praetor/protocol';
import { MandateService, MemoryMandateStore, type MandateDeps } from '../src/mandate.js';
import type { KycRecord } from '../src/kyc.js';
import type { Credential } from '@praetor/weid-client';

const W = (c: string) => `did:weid:101:0x${c.repeat(40)}`;
const ACCOUNT = '0x00000000000000000000000000000000000c0ffe';
const pk = softPasskey('lin');
const assertion = (challenge: Hex, key = pk) => {
  const a = key.sign(challenge);
  return { credentialId: key.credIdHash, authenticatorData: a.authenticatorData, clientDataJSON: a.clientDataJSON, r: toHex(a.r), s: toHex(a.s) };
};
const draft = { userRef: 'user-1', account: ACCOUNT, agentKey: '0x00000000000000000000000000000000000a6e47', scopes: ['rebalance', 'pay', 'standing_orders'], mandateHash: `0x${'ab'.repeat(32)}`, agentMeasurement: `0x${'cd'.repeat(32)}` };

describe('MandateService', () => {
  let calls: string[];
  let record: KycRecord | undefined;
  let deps: MandateDeps;
  let svc: MandateService;

  beforeEach(() => {
    calls = [];
    record = { userRef: 'user-1', account: ACCOUNT, method: 'vendor', state: 'issued', riskProfile: 'balanced', userWeId: W('u'), credentialHash: '0x1' };
    deps = {
      store: new MemoryMandateStore(),
      kycRecord: async () => record,
      identity: async () => ({ bankWeId: W('b'), kycCpt: 1, mandateCpt: 2 }),
      passkeyOf: async (account, credIdHash) => (account === ACCOUNT && credIdHash === pk.credIdHash ? { x: pk.x, y: pk.y } : null),
      weid: {
        createCredential: async (a) => { calls.push(`create:${a.issuer}:${a.cptId}`); return { id: 'inner', cptId: a.cptId, issuer: a.issuer, claim: a.claim, proof: {} } as Credential; },
        countersign: async (c, signer) => { calls.push(`countersign:${signer}`); return { credential: { id: 'outer', cptId: 107, issuer: signer, claim: { credentialList: [c] }, proof: {} } as unknown as Credential, hash: '0xouter' }; },
        createEvidence: async (_c, signer) => { calls.push(`evidence:${signer}`); return `0x${'e'.repeat(64)}`; },
      },
      rpId: 'praetor.localhost',
      origin: 'https://praetor.localhost',
    };
    svc = new MandateService(deps);
  });

  it('prepares the user-signed inner credential with the spec claim and a challenge over it', async () => {
    const p = await svc.prepare(draft);
    expect(p.claim).toEqual({ principal: W('u'), wallet: `eip155:84532:${ACCOUNT}`, agentKey: draft.agentKey, scopes: draft.scopes, mandateHash: draft.mandateHash, riskProfile: 'balanced', agentMeasurement: draft.agentMeasurement });
    expect(p.challenge).toMatch(/^0x[0-9a-f]{64}$/);
    expect(calls).toEqual([`create:${W('u')}:2`]);
  });

  it('countersigns and evidences only after the account passkey signs the challenge', async () => {
    const p = await svc.prepare(draft);
    const out = await svc.sign(p.draftId, assertion(p.challenge));
    expect(out.mandateCredentialHash).toBe(`0x${'e'.repeat(64)}`);
    expect(out.credential.issuer).toBe(W('b'));
    expect(calls).toEqual([`create:${W('u')}:2`, `countersign:${W('b')}`, `evidence:${W('b')}`]);
    await expect(svc.sign(p.draftId, assertion(p.challenge))).rejects.toThrow(/not pending/);
  });

  it('refuses another challenge, a passkey not on the account, and an unknown draft', async () => {
    const p = await svc.prepare(draft);
    await expect(svc.sign(p.draftId, assertion(`0x${'00'.repeat(32)}`))).rejects.toThrow(/challenge/);
    await expect(svc.sign(p.draftId, assertion(p.challenge, softPasskey('mallory')))).rejects.toThrow(/passkey/);
    await expect(svc.sign('nope', assertion(p.challenge))).rejects.toThrow(/unknown draft/);
    expect(calls).toEqual([`create:${W('u')}:2`]);
  });

  it('refuses a user without an issued PersonKYC, another account, or a scope outside the spec', async () => {
    record = { ...record!, state: 'verified' };
    await expect(svc.prepare(draft)).rejects.toThrow(/PersonKYC/);
    record = { ...record!, state: 'issued' };
    await expect(svc.prepare({ ...draft, account: '0x00000000000000000000000000000000000000aa' })).rejects.toThrow(/account/);
    await expect(svc.prepare({ ...draft, scopes: ['withdraw'] })).rejects.toThrow(/scope/);
  });
});
