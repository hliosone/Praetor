// F2 (spec 06): link WeChat. The web app starts LINK_WECHAT, the mini program (stand-in: the SOTER fixture behind the
// fake Tencent, SOTER_FAKE_TENCENT=1) scans, runs SOTER over the digest it recomputed and posts the result; the
// attester TEE proves it; the owner confirms with the passkey; the bank co-signs; the hook stores the binding.
import { describe, it, expect, beforeAll } from 'vitest';
import { MandateHookAbi } from '@praetor/chain';
import { bindingHash, digest, praetorDomain, soterChallenge } from '@praetor/protocol';
import { fakeSoterSignature } from '@praetor/soter-attester';
import { bootstrapConsortium, activateSoterAttester, pub, setDemoPrices, stack, type Stack } from '../../scripts/demo/lib.js';
import { WebClient, onboardViaApi } from '../../scripts/demo/web.js';

let s: Stack;
let web: WebClient;
const tag = Date.now().toString(36);
const mp = (path: string, body?: unknown) => fetch(`http://10.88.0.80:3200/mp${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));

beforeAll(async () => {
  s = stack();
  await bootstrapConsortium(s);
  await setDemoPrices(s);
  await activateSoterAttester(s);
  web = new WebClient(s, `f2-${tag}`);
  await onboardViaApi(web, `f2-${tag}`, { fullName: `Zqf2person Link${tag}`, birthdate: '1992-07-08', nationality: 'HK', documentNumber: `F2${tag}` });
}, 900_000);

describe('F2 link WeChat', () => {
  it('1-7: QR, SOTER over the recomputed digest, passkey confirmation, bank: bindingOf is the proof binding', async () => {
    const start = await web.ok('POST', '/api/wechat/link/start');
    const id = new URL(start.qr).searchParams.get('id')!;
    const view = (await mp(`/link/${id}`)).body;
    // The mini program recomputes the digest from what it shows before running SOTER.
    const ownerAction = { ...view.ownerAction, nonce: BigInt(view.ownerAction.nonce), expiresAt: BigInt(view.ownerAction.expiresAt) };
    expect(digest(praetorDomain(s.base.domainName, s.base.mandateHook), 'OwnerAction', ownerAction)).toBe(view.digest);
    const code = `f2-${tag}`;
    const resultJSON = JSON.stringify({ raw: soterChallenge(view.digest), counter: 1, uid: `uid-${tag}`, cpu_id: `cpu-${tag}` });
    expect((await mp(`/link/${id}/soter`, { code, resultJSON, resultJSONSignature: fakeSoterSignature(`openid-of-${code}`, resultJSON), authMode: 'facial' })).status).toBe(200);
    expect((await web.ok('GET', `/api/wechat/link/${id}`)).state).toBe('scanned');
    expect((await web.ok('POST', `/api/wechat/link/${id}/confirm`, { assertion: web.assert(start.digest) })).success).toBe(true);
    const binding = await pub(s).readContract({ address: s.base.mandateHook, abi: MandateHookAbi, functionName: 'bindingOf', args: [web.account!] });
    expect(binding).toBe(bindingHash({ mpAppId: 'wx-fake-local', openid: `openid-of-${code}`, uid: `uid-${tag}`, cpuId: `cpu-${tag}` }));
  }, 300_000);

  it('failure: a SOTER result over another digest is refused by the attester', async () => {
    const start = await web.ok('POST', '/api/wechat/link/start');
    const id = new URL(start.qr).searchParams.get('id')!;
    const code = `f2b-${tag}`;
    const resultJSON = JSON.stringify({ raw: 'a'.repeat(64), counter: 2, uid: `uid-${tag}`, cpu_id: `cpu-${tag}` });
    expect((await mp(`/link/${id}/soter`, { code, resultJSON, resultJSONSignature: fakeSoterSignature(`openid-of-${code}`, resultJSON), authMode: 'facial' })).status).toBe(403);
  }, 120_000);
});
