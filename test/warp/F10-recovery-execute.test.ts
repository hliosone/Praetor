// F10 step 6, the end of a recovery (spec 06): 48 h after the bank scheduled it and nobody cancelled, anyone executes
// it: the owner keys become the new passkey alone, the WeChat binding and the agent key are dropped. This moves the
// fork's clock forward by 48 h, so it runs after every other flow (make e2e).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Address } from 'viem';
import { AgentKeyValidatorAbi, MandateHookAbi } from '@praetor/chain';
import { softPasskey, type SoftPasskey } from '@praetor/protocol';
import { pub, setDemoPrices, stack, waitFor, waitHeartbeat, bootstrapConsortium, type Stack } from '../../scripts/demo/lib.js';
import { WebClient, kycMockSubmit, onboardViaApi } from '../../scripts/demo/web.js';

let s: Stack;
let web: WebClient;
const tag = Date.now().toString(36);
const person = { fullName: `Zqftenw Recover${tag}`, birthdate: '1985-09-10', nationality: 'HK', documentNumber: `F10W${tag}` };
const API = process.env.API_URL_HOST ?? 'http://10.88.0.80:3200';

async function signIn(pk: SoftPasskey): Promise<number> {
  const o = await fetch(`${API}/api/auth/options`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json());
  const r = await fetch(`${API}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response: pk.authentication(o.challenge) }) });
  return r.status;
}

beforeAll(async () => {
  s = stack();
  await bootstrapConsortium(s);
  await setDemoPrices(s);
  web = new WebClient(s, `f10w-${tag}`);
  await onboardViaApi(web, `f10w-${tag}`, person);
}, 900_000);

// The jump leaves the demo prices stale and the heartbeat expired: restore both for whatever runs next.
afterAll(async () => {
  await setDemoPrices(s);
  await waitHeartbeat(s);
}, 600_000);

describe('F10 recovery executed after 48 h', () => {
  it('6: scheduled after the matching re-KYC; 48 h later executeRecovery: only the new passkey signs in, the agent key is revoked', async () => {
    expect(await signIn(web.passkey)).toBe(200);
    const fresh = softPasskey(`f10w-new-${tag}`, s.rpId, s.origin);
    const o = await web.ok('POST', '/api/recover/options', { email: `f10w-${tag}@example.com` });
    const v = await web.ok('POST', '/api/recover/verify', { userId: o.userId, response: fresh.registration(o.options.challenge) });
    await kycMockSubmit(v.redirectUrl, person);
    await waitFor('recovery scheduled', async () => (await web.ok('GET', `/api/recover/${o.userId}`)).state === 'scheduled', 120_000);
    expect((await web.call('POST', `/api/recover/${o.userId}/execute`, {})).body.success).not.toBe(true);
    const rpc = (method: string, params: unknown[]) => pub(s).request({ method: method as never, params: params as never });
    await rpc('evm_increaseTime', [48 * 3600 + 60]);
    await rpc('evm_mine', []);
    expect((await web.ok('POST', `/api/recover/${o.userId}/execute`, {})).success).toBe(true);
    expect((await web.ok('GET', `/api/recover/${o.userId}`)).state).toBe('executed');
    expect(await signIn(fresh)).toBe(200);
    expect(await signIn(web.passkey)).toBe(401);
    const [, , revoked] = await pub(s).readContract({ address: s.base.agentKeyValidator, abi: AgentKeyValidatorAbi, functionName: 'agentOf', args: [web.account as Address] });
    expect(revoked).toBe(true);
    expect(await pub(s).readContract({ address: s.base.mandateHook, abi: MandateHookAbi, functionName: 'bindingOf', args: [web.account as Address] })).toBe(`0x${'00'.repeat(32)}`);
  }, 600_000);
});
