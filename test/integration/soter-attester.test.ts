// M7 links: api to soter-attester (caller HMAC), soter-attester to (fake) Tencent, bank quote check and activation
// on the hook through FISCO, and the hook's own SoterApproval digest matching what the attester signs.
import { describe, it, expect, beforeAll } from 'vitest';
import { concat, keccak256, recoverAddress, toHex, type Hex } from 'viem';
import { structHash } from '@praetor/protocol';
import { MandateHookAbi, baseNow } from '@praetor/chain';
import { activateSoterAttester, attesterCall, pub, stack, type Stack } from '../../scripts/demo/lib.js';
import { fakeSoterSignature } from '@praetor/soter-attester';

let s: Stack;
beforeAll(() => { s = stack(); });

describe('soter-attester', () => {
  it('is activated on the hook only through a verified quote', async () => {
    const attester = await activateSoterAttester(s);
    const [measurement, active] = (await pub(s).readContract({ address: s.base.mandateHook, abi: MandateHookAbi, functionName: 'attesterOf', args: [attester] })) as readonly [Hex, boolean];
    expect(active).toBe(true);
    expect(measurement).not.toBe(`0x${'00'.repeat(32)}`);
  }, 180_000);

  it('signs a SoterApproval whose digest is the one the hook computes', async () => {
    const digestHex = keccak256(toHex(`it-${Date.now()}`)).slice(2);
    const resultJSON = JSON.stringify({ raw: digestHex, counter: 3, uid: 'it-uid', cpu_id: 'it-cpu' });
    const account = '0x00000000000000000000000000000000000c0ffe';
    const expiresAt = Number(await baseNow(pub(s))) + 600;
    const r = await attesterCall(s, '/v1/soter/approve', { code: 'it-code', account, digestHex, expiresAt, authMode: 'facial', resultJSON, resultJSONSignature: fakeSoterSignature('openid-of-it-code', resultJSON) });
    expect(r.status).toBe(200);
    const a = r.body.soterApproval;
    // EIP-712 digest under the hook's own on-chain domain separator.
    const sep = (await pub(s).readContract({ address: s.base.mandateHook, abi: MandateHookAbi, functionName: 'domainSeparator' })) as Hex;
    const sh = structHash('SoterApproval', { account: a.account, digest: a.digest, bindingHash: a.bindingHash, soterCounter: BigInt(a.soterCounter), expiresAt: BigInt(a.expiresAt) });
    const onChain = keccak256(concat(['0x1901', sep, sh]));
    const { attester } = (await attesterCall(s, '/v1/info')).body;
    expect(await recoverAddress({ hash: onChain, signature: r.body.attesterSig })).toBe(attester);
  });

  it('refuses a device result that Tencent does not verify', async () => {
    const digestHex = keccak256(toHex('x')).slice(2);
    const resultJSON = JSON.stringify({ raw: digestHex, counter: 1, uid: 'u', cpu_id: 'c' });
    const r = await attesterCall(s, '/v1/soter/approve', { code: 'it-code', account: '0x00000000000000000000000000000000000c0ffe', digestHex, expiresAt: Math.floor(Date.now() / 1000) + 600, authMode: 'facial', resultJSON, resultJSONSignature: fakeSoterSignature('someone-else', resultJSON) });
    expect(r.status).toBe(403);
  });
});
