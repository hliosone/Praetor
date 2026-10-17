import { describe, it, expect } from 'vitest';
import { decodeFunctionData, keccak256, toHex, type Address, type Hex } from 'viem';
import { MandateHookAbi } from '@praetor/chain';
import { digest, praetorDomain, softPasskey, AuthKind } from '@praetor/protocol';
import { Approvals, MemoryApprovalStore, type ApprovalDeps } from '../src/approvals.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as Address;
const HOOK = '0x00000000000000000000000000000000000000aa' as Address;
const pk = softPasskey('approvals', 'praetor.localhost', 'https://praetor.localhost');
const b64 = (h: Hex) => Buffer.from(h.slice(2), 'hex').toString('base64url');
const CALL = { to: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address, value: 0n, data: '0xa9059cbb' as Hex };
const CALLHASH = keccak256(toHex('callhash'));

function setup(over: Partial<ApprovalDeps> = {}) {
  const tx: { to: Address; data: Hex }[] = [];
  const resubmitted: unknown[] = [];
  const store = new MemoryApprovalStore();
  const a = new Approvals({
    store, domain: { name: 'Praetor-test', hook: HOOK }, now: async () => 1_800_000_000n, credIdHashOf: async () => pk.credIdHash,
    bundler: { tx: async (to, data) => { tx.push({ to, data }); return { txHash: `0x${'11'.repeat(32)}` as Hex, success: true }; } },
    resubmit: async (account, calls) => { resubmitted.push({ account, calls }); return { success: true, txHash: `0x${'22'.repeat(32)}` as Hex }; },
    attester: { approve: async (b) => ({ soterApproval: { account: ACCOUNT, digest: `0x${String(b.digestHex)}`, bindingHash: `0x${'33'.repeat(32)}`, soterCounter: '5', expiresAt: String(b.expiresAt) }, attesterSig: '0xab' as Hex }) },
    ...over,
  });
  return { a, tx, resubmitted, store };
}

describe('Tier-2 approvals (F6)', () => {
  it('a request carries the call preimage and the Tier2Approval digest (15 minutes)', async () => {
    const { a } = setup();
    const { id } = await a.request({ account: ACCOUNT, calls: [CALL], callHash: CALLHASH, reason: 'UNKNOWN_PAYEE', summary: 'Pay 300 USDC to Café Lumen' });
    const r = (await a.get(ACCOUNT, id))!;
    expect(r.tier2).toMatchObject({ account: ACCOUNT, callHash: CALLHASH, expiresAt: '1800000900' });
    expect(r.digest).toBe(digest(praetorDomain('Praetor-test', HOOK), 'Tier2Approval', { account: ACCOUNT, callHash: CALLHASH, nonce: BigInt(r.tier2.nonce), expiresAt: 1_800_000_900n }));
    expect(r.calls[0]).toMatchObject({ to: CALL.to, value: '0', data: CALL.data });
  });

  it('notifies the owner when a request opens (F6 step 4), with the approval link', async () => {
    const notes: unknown[] = [];
    const { a } = setup({ notify: async (n) => { notes.push(n); }, publicUrl: 'https://praetor.localhost' });
    const { id } = await a.request({ account: ACCOUNT, calls: [CALL], callHash: CALLHASH, reason: 'UNKNOWN_PAYEE', summary: 'Pay 300.00 USDC to Café Lumen' });
    expect(notes).toEqual([{ account: ACCOUNT, kind: 'approval', text: 'Approve? Pay 300.00 USDC to Café Lumen', link: `https://praetor.localhost/approve/${id}` }]);
  });

  it('passkey: registerApproval with the owner auth, then the same call is resubmitted by the agent', async () => {
    const { a, tx, resubmitted } = setup();
    const { id } = await a.request({ account: ACCOUNT, calls: [CALL], callHash: CALLHASH, reason: 'UNKNOWN_PAYEE', summary: 's' });
    const r = (await a.get(ACCOUNT, id))!;
    const out = await a.approveWithPasskey(ACCOUNT, id, pk.authentication(b64(r.digest)));
    expect(out).toMatchObject({ state: 'executed' });
    const call = decodeFunctionData({ abi: MandateHookAbi, data: tx[0]!.data });
    expect(call.functionName).toBe('registerApproval');
    expect(((call.args as unknown as unknown[])[1] as { kind: number }).kind).toBe(AuthKind.PASSKEY);
    expect(resubmitted).toHaveLength(1);
    expect((await a.get(ACCOUNT, id))!.state).toBe('executed');
  });

  it('SOTER: the attester proof over the digest becomes a SOTER owner auth', async () => {
    const { a, tx } = setup();
    const { id } = await a.request({ account: ACCOUNT, calls: [CALL], callHash: CALLHASH, reason: 'OVER_AUTO_CAP', summary: 's' });
    await a.approveWithSoter(ACCOUNT, id, { code: 'c', resultJSON: '{}', resultJSONSignature: 'sig', authMode: 'facial' });
    const call = decodeFunctionData({ abi: MandateHookAbi, data: tx[0]!.data });
    expect(((call.args as unknown as unknown[])[1] as { kind: number }).kind).toBe(AuthKind.SOTER);
  });

  it('refuses another account, a decided request, and an expired one', async () => {
    const { a, store } = setup();
    const { id } = await a.request({ account: ACCOUNT, calls: [CALL], callHash: CALLHASH, reason: 'UNKNOWN_PAYEE', summary: 's' });
    const r = (await a.get(ACCOUNT, id))!;
    expect(await a.get('0x00000000000000000000000000000000000000bb', id)).toBeNull();
    await a.reject(ACCOUNT, id);
    await expect(a.approveWithPasskey(ACCOUNT, id, pk.authentication(b64(r.digest)))).rejects.toThrow(/pending/);
    const { id: id2 } = await a.request({ account: ACCOUNT, calls: [CALL], callHash: CALLHASH, reason: 'UNKNOWN_PAYEE', summary: 's' });
    store.rows.get(id2)!.expiresAt = '1799999999';
    await expect(a.approveWithPasskey(ACCOUNT, id2, pk.authentication(b64((await a.get(ACCOUNT, id2))!.digest)))).rejects.toThrow(/expired/);
  });
});
