// F3 (spec 06): the owner sets the mandate through the api: the bank checks it against its caps on FISCO, the owner
// signs the OwnerAction with the passkey, the bank co-signs, the hook stores it. Failures: above the bank caps (the
// failed rule is shown), and a replayed owner action.
import { describe, it, expect, beforeAll } from 'vitest';
import { keccak256 } from 'viem';
import { MandateHookAbi } from '@praetor/chain';
import { encodePolicy } from '@praetor/protocol';
import { bootstrapConsortium, ensureDeskLiquidity, linPolicy, pub, setDemoPrices, stack, type Stack } from '../../scripts/demo/lib.js';
import { WebClient, onboardViaApi, policyJson } from '../../scripts/demo/web.js';
import { baseNow } from '@praetor/chain';

let s: Stack;
let web: WebClient;
const tag = Date.now().toString(36);

beforeAll(async () => {
  s = stack();
  await bootstrapConsortium(s);
  await setDemoPrices(s);
  await ensureDeskLiquidity(s);
  web = new WebClient(s, `f3-${tag}`);
  await onboardViaApi(web, `f3-${tag}`, { fullName: `Zqf3person Mandate${tag}`, birthdate: '1989-05-06', nationality: 'HK', documentNumber: `F3${tag}` });
}, 900_000);

describe('F3 mandate', () => {
  it('3-6: checked by the bank on FISCO, signed by the owner, co-signed, stored: policyHashOf equals the local hash', async () => {
    const p = { ...linPolicy(s, 0n), validUntil: (await baseNow(pub(s))) + 31_536_000n };
    const prop = await web.ok('POST', '/api/policy/propose', { policy: policyJson(p) });
    expect(prop.ok).toBe(true);
    const r = await web.ownerAction(prop);
    expect(r.success).toBe(true);
    expect(await pub(s).readContract({ address: s.base.mandateHook, abi: MandateHookAbi, functionName: 'policyHashOf', args: [web.account!] })).toBe(keccak256(encodePolicy(p)));
    // A replay of the same signed owner action is refused on-chain (digest already used).
    const again = await web.call('POST', '/api/owner-actions/submit', { ownerAction: prop.ownerAction, payload: prop.payload, assertion: web.assert(prop.digest) });
    expect(again.body?.success ?? false).toBe(false);
  }, 300_000);

  it('failure: a hard cap above the bank cap of the profile is refused with the failed rule', async () => {
    const p = { ...linPolicy(s, 0n), hardCap: 50_000_000_000n, validUntil: (await baseNow(pub(s))) + 31_536_000n };
    expect(await web.ok('POST', '/api/policy/propose', { policy: policyJson(p) })).toEqual({ ok: false, failedRule: 2 });
  }, 120_000);
});
