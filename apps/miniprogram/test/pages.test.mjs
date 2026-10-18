// Page logic against a fake WeChat (test/harness.mjs): what each page shows and which wx calls and api requests it
// makes, for home, approve (F6 step 5a) and link (F2 steps 2-3).
import { describe, it, expect, afterEach } from 'vitest';
import { fakeWx, launch, page, settle } from './harness.mjs';
import { ACCOUNT, CFG, NOW, activity, approvalView, linkView, mpApi, portfolio, status } from './fixtures.mjs';

const session = (account) => () => ({ token: account ? 'T-linked' : 'T-guest', account, expiresAt: NOW + 7200 });
let open = [];
const start = async (p, query = {}) => { open.push(p); await p.onLoad?.(query); await p.onShow?.(); await settle(); return p; };
afterEach(() => { for (const p of open) p.onUnload?.(); open = []; });

describe('home', () => {
  it('a WeChat user not linked yet: the link card, and no account read', async () => {
    const wx = fakeWx({ api: mpApi({ 'POST /session': session(null) }) });
    await launch(wx);
    const p = await start(page('home'));
    expect(p.data).toMatchObject({ loading: false, linked: false });
    expect(wx.named('request').map((c) => c.opts.url)).toEqual(['https://praetor-tunnel.trycloudflare.com/mp/session']);
  });

  it('linked: total, rings, status pill, last decisions in words, and what waits for the owner (decoded, not the api summary)', async () => {
    const wx = fakeWx({ api: mpApi({
      'POST /session': session(ACCOUNT), 'GET /config': () => CFG, 'GET /portfolio': () => portfolio, 'GET /status': () => status(),
      'GET /activity?limit=5': () => activity, 'GET /approvals?state=pending': () => ({ approvals: [approvalView()] }),
    }) });
    await launch(wx);
    const p = await start(page('home'));
    expect(p.data).toMatchObject({ linked: true, total: '10,000.00', frozen: false, pill: { cls: 'signed', label: 'Active' } });
    expect(p.data.assets.map((a) => [a.symbol, a.weight, a.demo])).toEqual([['USDC', '53.0%', false], ['tXAU', '32.0%', true], ['tXAG', '15.0%', true]]);
    expect(p.data.decisions.map((d) => [d.cls, d.text])).toEqual([
      ['signed', 'Allowed by the mandate'], ['refused', 'Payee on the sanctions list'], ['asked', 'The payee is not in your mandate'],
    ]);
    expect(p.data.pending).toEqual([{ id: 'a1', text: 'Pay 300 USDC to 0x1111…1111', why: 'The payee is not in your mandate' }]);
    expect(wx.named('ctx.arc')).toHaveLength(6);
  });

  it('a sign-in that failed at launch (tunnel down) is retried by the next refresh', async () => {
    let up = false;
    const wx = fakeWx({ api: mpApi({
      'POST /session': () => (up ? session(ACCOUNT)() : { statusCode: 502, data: { error: 'bad gateway' } }),
      'GET /config': () => CFG, 'GET /portfolio': () => portfolio, 'GET /status': () => status(),
      'GET /activity?limit=5': () => activity, 'GET /approvals?state=pending': () => ({ approvals: [] }),
    }) });
    await launch(wx);
    const p = await start(page('home'));
    expect(p.data).toMatchObject({ linked: false, error: 'Something went wrong: bad gateway' });
    up = true;
    await p.refresh();
    expect(p.data).toMatchObject({ linked: true, error: '', total: '10,000.00' });
  });

  it('frozen by the regulator: the red banner', async () => {
    const wx = fakeWx({ api: mpApi({
      'POST /session': session(ACCOUNT), 'GET /config': () => CFG, 'GET /portfolio': () => portfolio, 'GET /status': () => status('FROZEN'),
      'GET /activity?limit=5': () => ({ items: [] }), 'GET /approvals?state=pending': () => ({ approvals: [] }),
    }) });
    await launch(wx);
    const p = await start(page('home'));
    expect(p.data).toMatchObject({ frozen: true, pill: { cls: 'refused', label: 'Frozen' } });
  });

  it('opens an approval, the chat and the link page', async () => {
    const wx = fakeWx({ api: mpApi({ 'POST /session': session(null) }) });
    await launch(wx);
    const p = await start(page('home'));
    p.openApproval({ currentTarget: { dataset: { id: 'a1' } } });
    p.goChat();
    p.goLink();
    await settle();
    expect(wx.named('navigateTo').map((c) => c.opts.url)).toEqual(['/pages/approve/approve?id=a1', '/pages/chat/chat', '/pages/link/link']);
  });
});

function approveApi(view, extra = {}) {
  const posted = [];
  const api = mpApi({
    'POST /session': session(ACCOUNT), 'GET /config': () => CFG, 'GET /status': () => status(), [`GET /approvals/${view.id}`]: () => view,
    [`POST /approvals/${view.id}/soter`]: (o) => { posted.push(o); return { state: 'executed', registerTx: `0x${'11'.repeat(32)}`, executeTx: `0x${'22'.repeat(32)}` }; },
    [`POST /approvals/${view.id}/reject`]: (o) => { posted.push(o); return { state: 'rejected' }; },
    ...extra,
  });
  return { api, posted };
}

describe('approve (F6 step 5a)', () => {
  it('shows the decoded call, the reason in words and the Base-time countdown; Face ID signs the digest computed here', async () => {
    const v = approvalView();
    const { api, posted } = approveApi(v);
    const wx = fakeWx({ api });
    await launch(wx);
    const p = await start(page('approve'), { id: 'a1' });
    expect(p.data).toMatchObject({ ok: true, refuse: '', what: `Pay 300 USDC to ${'0x1111111111111111111111111111111111111111'}`, why: 'The payee is not in your mandate', expires: 'Expires in 15:00', mode: 'facial', digest: v.digest });
    await p.approve();
    await settle();
    const soter = wx.named('startSoterAuthentication');
    expect(soter).toHaveLength(1);
    expect(soter[0].opts).toMatchObject({ requestAuthModes: ['facial'], challenge: v.digest.slice(2), authContent: 'Approve: Pay 300 USDC to 0x1111…1111' });
    // The code for the attester comes from a wx.login made after Face ID, never the one the session used.
    const order = wx.calls.map((c) => c.name).filter((n) => n === 'login' || n === 'startSoterAuthentication');
    expect(order).toEqual(['login', 'startSoterAuthentication', 'login']);
    expect(posted[0].data).toMatchObject({ code: 'code-2', authMode: 'facial', resultJSONSignature: 'device-sig' });
    expect(JSON.parse(posted[0].data.resultJSON).raw).toBe(v.digest.slice(2));
    expect(posted[0].header).toEqual({ 'content-type': 'application/json', authorization: 'Bearer T-linked' });
    expect(p.data).toMatchObject({ result: 'executed', resultText: 'Approved and executed', busy: false });
  });

  it('refuses to sign a request whose digest does not match what it shows: no Face ID prompt', async () => {
    const { api, posted } = approveApi(approvalView({ digest: `0x${'99'.repeat(32)}` }));
    const wx = fakeWx({ api });
    await launch(wx);
    const p = await start(page('approve'), { id: 'a1' });
    expect(p.data.ok).toBe(false);
    expect(p.data.refuse).toBe('Not signing: the digest from the server differs from the one computed here');
    await p.approve();
    expect(wx.named('startSoterAuthentication')).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });

  it('the expiry pill reads as one sentence in Chinese too, and the countdown keeps it filled', async () => {
    const wx = fakeWx({ api: approveApi(approvalView()).api, language: 'zh_CN' });
    await launch(wx);
    const p = await start(page('approve'), { id: 'a1' });
    expect(p.data.expires).toBe('15:00 后过期');
    p.expiresAt = String(Number(p.expiresAt) - 61);
    p.tick();
    expect(p.data.expires).toMatch(/^\d+:\d\d 后过期$/);
    expect(p.data.expires).not.toBe('15:00 后过期');
  });

  it('a phone without Face ID or fingerprint for WeChat: points to the passkey in the web app', async () => {
    const wx = fakeWx({ api: approveApi(approvalView()).api, supportMode: [] });
    await launch(wx);
    const p = await start(page('approve'), { id: 'a1' });
    expect(p.data).toMatchObject({ ok: true, mode: null, noSoter: true });
  });

  it('a cancelled Face ID prompt posts nothing', async () => {
    const { api, posted } = approveApi(approvalView());
    const wx = fakeWx({ api, soter: () => ({ errCode: 90008, errMsg: 'startSoterAuthentication:fail cancel' }) });
    await launch(wx);
    const p = await start(page('approve'), { id: 'a1' });
    await p.approve();
    await settle();
    expect(posted).toHaveLength(0);
    expect(p.data.error).toMatch(/90008/);
    expect(p.data.busy).toBe(false);
  });

  it('rejects', async () => {
    const { api, posted } = approveApi(approvalView());
    const wx = fakeWx({ api });
    await launch(wx);
    const p = await start(page('approve'), { id: 'a1' });
    await p.reject();
    expect(posted[0].url).toMatch(/\/mp\/approvals\/a1\/reject$/);
    expect(p.data.result).toBe('rejected');
  });

  it('a decided request shows its state and no button', async () => {
    const wx = fakeWx({ api: approveApi(approvalView({ state: 'executed' })).api });
    await launch(wx);
    const p = await start(page('approve'), { id: 'a1' });
    expect(p.data).toMatchObject({ ok: false, refuse: '', result: 'executed', resultText: 'Approved and executed' });
  });
});

describe('link (F2 steps 2-3)', () => {
  function linkApi(view, after = 'linked') {
    const posted = [];
    let polls = 0;
    let linked = false;
    const api = mpApi({
      'POST /session': () => ({ token: linked ? 'T-linked' : 'T-guest', account: linked ? ACCOUNT : null, expiresAt: NOW + 7200 }),
      'GET /config': () => CFG,
      'GET /link/0f8fad5b-d9cb-469f-a165-70867728950e': () => {
        if (!posted.length) return view;
        polls += 1;
        if (polls > 1 && after === 'linked') linked = true;
        return { ...view, state: polls > 1 ? after : 'scanned' };
      },
      'POST /link/0f8fad5b-d9cb-469f-a165-70867728950e/soter': (o) => { posted.push(o); return { state: 'scanned' }; },
    });
    return { api, posted };
  }
  const QR = 'https://praetor.localhost/mp/link?id=0f8fad5b-d9cb-469f-a165-70867728950e';

  it('scan, recompute, Face ID over the link digest, then the passkey on the web; the next sign-in has the account', async () => {
    const v = linkView();
    const { api, posted } = linkApi(v);
    const wx = fakeWx({ api, qr: QR });
    await launch(wx);
    const p = await start(page('link'));
    p.pollMs = 0;
    await p.scan();
    await settle();
    expect(p.data).toMatchObject({ stage: 'confirm', account: ACCOUNT, refuse: '' });
    await p.confirm();
    await settle(30);
    expect(wx.named('startSoterAuthentication')[0].opts).toMatchObject({ challenge: v.digest.slice(2), authContent: 'Link WeChat to 0x0000…0ffe' });
    expect(posted[0].header).toEqual({ 'content-type': 'application/json', authorization: 'Bearer T-guest' });
    expect(posted[0].data.code).toBe('code-2');
    expect(p.data.stage).toBe('linked');
    expect(getApp().session.account()).toBe(ACCOUNT);
  });

  it('refuses a QR code that is not a Praetor link, and another owner action shown as a link', async () => {
    const wx = fakeWx({ api: linkApi(linkView({ ownerAction: { ...linkView().ownerAction, action: 10 } })).api, qr: 'weixin://wxpay/bizpayurl?pr=x' });
    await launch(wx);
    const p = await start(page('link'));
    await p.scan();
    expect(p.data.refuse).toBe('Not signing: this is not a Praetor link QR code');
    await p.load('0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(p.data).toMatchObject({ stage: 'scan', refuse: 'Not signing: the request is not a WeChat link' });
    await p.confirm();
    expect(wx.named('startSoterAuthentication')).toHaveLength(0);
  });
});
