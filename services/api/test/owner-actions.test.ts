import { describe, it, expect } from 'vitest';
import { decodeFunctionData, keccak256, toHex, type Address, type Hex } from 'viem';
import { MandateHookAbi } from '@praetor/chain';
import { digest, praetorDomain, softPasskey, OwnerActionKind as K } from '@praetor/protocol';
import { OwnerActions, BANK_REQUIRED } from '../src/owner-actions.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as Address;
const HOOK = '0x00000000000000000000000000000000000000aa' as Address;
const AGENT = '0x00000000000000000000000000000000000a6e47' as Address;
const pk = softPasskey('owner-actions', 'praetor.localhost', 'https://praetor.localhost');
const b64 = (h: Hex) => Buffer.from(h.slice(2), 'hex').toString('base64url');

function setup() {
  const sent: { to: Address; data: Hex }[] = [];
  const cosigned: unknown[] = [];
  const oa = new OwnerActions({
    domain: { name: 'Praetor-test', hook: HOOK },
    now: async () => 1_800_000_000n,
    credIdHashOf: async () => pk.credIdHash,
    bank: { cosign: async (a) => { cosigned.push(a); return { bankSig: '0xbb' as Hex, digest: '0x' as Hex }; } },
    bundler: { tx: async (to, data) => { sent.push({ to, data }); return { txHash: `0x${'11'.repeat(32)}` as Hex, success: true }; } },
  });
  return { oa, sent, cosigned };
}

describe('owner actions through the api (untrusted pipe: the owner signs the digest it sees)', () => {
  it('prepares SET_AGENT_KEY with a 10-minute expiry and the digest of spec 02', async () => {
    const { oa } = setup();
    const p = await oa.prepare(ACCOUNT, { kind: K.SET_AGENT_KEY, account: ACCOUNT, agentKey: AGENT, validUntil: 1_802_592_000 });
    expect(p.ownerAction.expiresAt).toBe(1_800_000_600n);
    expect(p.digest).toBe(digest(praetorDomain('Praetor-test', HOOK), 'OwnerAction', p.ownerAction));
  });

  it('names the credential the assertion came from (an account can hold several passkeys)', async () => {
    const seen: string[] = [];
    const oa = new OwnerActions({
      domain: { name: 'Praetor-test', hook: HOOK }, now: async () => 1_800_000_000n,
      credIdHashOf: async (_account, credentialId) => { seen.push(credentialId); return pk.credIdHash; },
      bank: { cosign: async () => ({ bankSig: '0xbb' as Hex, digest: '0x' as Hex }) },
      bundler: { tx: async () => ({ txHash: null, success: true }) },
    });
    const p = await oa.prepare(ACCOUNT, { kind: K.PAUSE_AGENT, account: ACCOUNT });
    await oa.submit(ACCOUNT, { ownerAction: p.ownerAction, payload: p.payload, assertion: pk.authentication(b64(p.digest)) });
    expect(seen).toEqual([pk.credentialId]);
  });

  it('submits with the owner passkey and the bank co-signature to applyOwnerAction', async () => {
    const { oa, sent, cosigned } = setup();
    const p = await oa.prepare(ACCOUNT, { kind: K.SET_AGENT_KEY, account: ACCOUNT, agentKey: AGENT, validUntil: 1_802_592_000 });
    const r = await oa.submit(ACCOUNT, { ownerAction: p.ownerAction, payload: p.payload, assertion: pk.authentication(b64(p.digest)) });
    expect(r.success).toBe(true);
    expect(cosigned).toHaveLength(1);
    const call = decodeFunctionData({ abi: MandateHookAbi, data: sent[0]!.data });
    expect(call.functionName).toBe('applyOwnerAction');
    expect((call.args as unknown as unknown[])[3]).toEqual(['0xbb']);
  });

  it('owner-alone kinds go without the bank', async () => {
    const { oa, cosigned } = setup();
    expect(BANK_REQUIRED.has(K.PAUSE_AGENT)).toBe(false);
    const p = await oa.prepare(ACCOUNT, { kind: K.PAUSE_AGENT, account: ACCOUNT });
    await oa.submit(ACCOUNT, { ownerAction: p.ownerAction, payload: p.payload, assertion: pk.authentication(b64(p.digest)) });
    expect(cosigned).toHaveLength(0);
  });

  it('refuses another account, a payload that does not match its hash, or a passkey over another digest', async () => {
    const { oa, sent } = setup();
    const p = await oa.prepare(ACCOUNT, { kind: K.SET_AGENT_KEY, account: ACCOUNT, agentKey: AGENT, validUntil: 1_802_592_000 });
    const good = pk.authentication(b64(p.digest));
    await expect(oa.submit('0x00000000000000000000000000000000000000bb', { ownerAction: p.ownerAction, payload: p.payload, assertion: good })).rejects.toThrow(/account/);
    await expect(oa.submit(ACCOUNT, { ownerAction: p.ownerAction, payload: '0x1234', assertion: good })).rejects.toThrow(/payload/);
    await expect(oa.submit(ACCOUNT, { ownerAction: p.ownerAction, payload: p.payload, assertion: pk.authentication(b64(keccak256(toHex('x')))) })).rejects.toThrow(/challenge/);
    expect(sent).toHaveLength(0);
  });
});

describe('standing orders (F7 step 2)', () => {
  it('ADD_STANDING_ORDER carries the order (payloadHash = its EIP-712 struct hash) and needs the bank', async () => {
    const { oa, sent, cosigned } = setup();
    const order = { account: ACCOUNT, id: 1, payee: AGENT, amount: 1_200_000_000n, period: 2_592_000, firstDue: 1_800_000_000n, rail: 1, merchantRef: `0x${'cc'.repeat(32)}` as Hex };
    const p = await oa.prepare(ACCOUNT, { kind: K.ADD_STANDING_ORDER, account: ACCOUNT, order });
    expect(p.ownerAction.payloadHash).toBe((await import('@praetor/protocol')).structHash('StandingOrder', order));
    await oa.submit(ACCOUNT, { ownerAction: p.ownerAction, payload: p.payload, assertion: pk.authentication(b64(p.digest)) });
    expect(cosigned).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });
});
