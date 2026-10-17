import { describe, it, expect } from 'vitest';
import { ensureBankIdentity, memoIdentity } from '../src/identity.js';
import type { WeidClient } from '@praetor/weid-client';

const W = 'did:weid:101:0x' + 'b'.repeat(40);
function fakeWeid(docExists = true) {
  const calls: string[] = [];
  const weid = {
    getWeIdDocument: async () => { calls.push('getDoc'); if (!docExists) throw new Error('gone'); return {}; },
    createWeId: async () => { calls.push('createWeId'); return W; },
    ensureRecognizedIssuer: async (_w: string, name: string) => { calls.push(`issuer:${name}`); },
    issuerSetup: async () => { calls.push('setup'); return { authorityIssuer: true, kycProvider: true }; },
    registerCpt: async (_o: string, s: { title: string }) => { calls.push(`cpt:${s.title}`); return s.title === 'PersonKYC' ? 11 : 12; },
  } as unknown as WeidClient;
  return { weid, calls };
}
const kv = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { m, get: async (k: string) => m.get(k), set: async (k: string, v: string) => void m.set(k, v) };
};

describe('ensureBankIdentity', () => {
  it('sets up the WeID, issuer and both CPTs once, then reuses them', async () => {
    const { weid, calls } = fakeWeid();
    const store = kv();
    expect(await ensureBankIdentity(weid, store)).toEqual({ bankWeId: W, kycCpt: 11, mandateCpt: 12 });
    expect(calls).toEqual(['createWeId', `issuer:Praetor Demo Bank ${W.slice(-8)}`, 'setup', 'cpt:PersonKYC', 'cpt:AgentMandate']);
    calls.length = 0;
    expect(await ensureBankIdentity(weid, store)).toEqual({ bankWeId: W, kycCpt: 11, mandateCpt: 12 });
    expect(calls).toEqual(['getDoc']);
  });

  it('redoes the setup when the stored WeID no longer exists on chain', async () => {
    const { weid, calls } = fakeWeid(false);
    await ensureBankIdentity(weid, kv({ bankWeId: W, kycCpt: '1', mandateCpt: '2' }));
    expect(calls[1]).toBe('createWeId');
  });

  it('memoIdentity retries after a failure', async () => {
    let n = 0;
    const f = memoIdentity(async () => { n++; if (n === 1) throw new Error('down'); return { bankWeId: W, kycCpt: 1, mandateCpt: 2 }; });
    await expect(f()).rejects.toThrow('down');
    expect((await f()).bankWeId).toBe(W);
    await f();
    expect(n).toBe(2);
  });
});
