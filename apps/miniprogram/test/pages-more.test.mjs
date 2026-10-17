// Page logic of chat, activity, payments, settings and support against a fake WeChat.
import { describe, it, expect, afterEach } from 'vitest';
import { fakeWx, launch, page, settle } from './harness.mjs';
import { ACCOUNT, NOW, activity, mpApi } from './fixtures.mjs';

const linked = () => ({ token: 'T-linked', account: ACCOUNT, expiresAt: NOW + 7200 });
let open = [];
const start = async (p, query = {}) => { open.push(p); await p.onLoad?.(query); await p.onShow?.(); await settle(); return p; };
afterEach(() => { for (const p of open) p.onUnload?.(); open = []; });

describe('chat', () => {
  it('a quick chip asks the agent; its answer and the tools it used appear', async () => {
    const asked = [];
    const wx = fakeWx({ api: mpApi({
      'POST /session': linked,
      'POST /agent/chat': (o) => { asked.push(o.data.message); return 'event: started\ndata: {}\n\nevent: result\ndata: {"text":"You hold 10,000 USD.","tools":[{"tool":"praetor_get_portfolio","status":"completed"}]}\n\n'; },
    }) });
    await launch(wx);
    const p = await start(page('chat'));
    expect(p.data.chips.map((c) => c.text)).toEqual(['How am I doing?', 'Pay the café 12.50', 'Should I rebalance?']);
    await p.sendChip({ currentTarget: { dataset: { text: 'How am I doing?' } } });
    expect(asked).toEqual(['How am I doing?']);
    expect(p.data.messages).toEqual([
      { who: 'me', text: 'How am I doing?', tools: '' },
      { who: 'agent', text: 'You hold 10,000 USD.', tools: 'Tools: get_portfolio' },
    ]);
    expect(p.data.busy).toBe(false);
  });

  it('typed text is sent once, trimmed; an agent error is shown in the thread', async () => {
    const wx = fakeWx({ api: mpApi({ 'POST /session': linked, 'POST /agent/chat': () => 'event: error\ndata: {"error":"model unavailable"}\n\n' }) });
    await launch(wx);
    const p = await start(page('chat'));
    p.onInput({ detail: { value: '  Rebalance?  ' } });
    await p.send();
    expect(p.data.messages[0]).toEqual({ who: 'me', text: 'Rebalance?', tools: '' });
    expect(p.data.messages[1].text).toBe('(model unavailable)');
    expect(p.data.input).toBe('');
    await p.send();
    expect(p.data.messages).toHaveLength(2);
  });
});

describe('activity', () => {
  it('lists decisions with tier badges and reasons in words; a tap copies the BaseScan link', async () => {
    const wx = fakeWx({ api: mpApi({ 'POST /session': linked, 'GET /activity?limit=50': () => activity }) });
    await launch(wx);
    const p = await start(page('activity'));
    expect(p.data.rows.map((r) => [r.cls, r.tier, r.text, r.amount])).toEqual([
      ['signed', 'T1', 'Allowed by the mandate', '12.50'], ['refused', 'T0', 'Payee on the sanctions list', ''], ['asked', 'T2', 'The payee is not in your mandate', ''],
    ]);
    await p.copyTx({ currentTarget: { dataset: { url: `https://sepolia.basescan.org/tx/0x${'aa'.repeat(32)}` } } });
    expect(wx.named('setClipboardData')[0].opts.data).toBe(`https://sepolia.basescan.org/tx/0x${'aa'.repeat(32)}`);
  });
});

describe('payments', () => {
  const orders = {
    orders: [{ id: 1, payee: '0x00000000000000000000000000000000000000c1', amount: '1200000000', period: 2592000, nextDue: '1800086400', rail: 1, merchantRef: `0x${'92'.repeat(32)}`, active: true, merchant: 'Kowloon Lettings' }],
    proposals: [{ id: 'p1', summary: '45.00 USDC weekly to Utilities', state: 'pending' }, { id: 'p2', summary: 'old', state: 'dismissed' }],
  };

  it('shows the standing orders (read only) and the agent\'s pending proposals', async () => {
    const wx = fakeWx({ api: mpApi({ 'POST /session': linked, 'GET /standing-orders': () => orders }) });
    await launch(wx);
    const p = await start(page('payments'));
    expect(p.data.orders).toEqual([{ id: 1, to: 'Kowloon Lettings', rail: 'Alipay+', amount: '1,200', every: 'every 30 days', next: 'next on 2027-01-16', active: true }]);
    expect(p.data.proposals).toEqual([{ id: 'p1', text: '45.00 USDC weekly to Utilities' }]);
  });

  it('proposing one hands over to the web app (passkey + bank): the link is copied and explained', async () => {
    const wx = fakeWx({ api: mpApi({ 'POST /session': linked, 'GET /standing-orders': () => orders }) });
    await launch(wx);
    const p = await start(page('payments'));
    await p.propose();
    expect(wx.named('setClipboardData')[0].opts.data).toBe('https://praetor-tunnel.trycloudflare.com/payments');
    expect(wx.named('showModal')[0].opts.content).toMatch(/passkey and the bank/);
  });
});

describe('settings', () => {
  it('switches the language and remembers it', async () => {
    const wx = fakeWx({ api: mpApi({ 'POST /session': linked }) });
    const app = await launch(wx);
    const p = await start(page('settings'));
    expect(p.data).toMatchObject({ lang: 'en', account: ACCOUNT, showSupport: true });
    p.setLang({ currentTarget: { dataset: { lang: 'zh-CN' } } });
    expect(app.lang).toBe('zh-CN');
    expect(wx.storage.lang).toBe('zh-CN');
    expect(p.data.t.settings.title).toBe('设置');
  });

  it('unlink is owner alone with the passkey: the web app\'s settings link is copied and explained', async () => {
    const wx = fakeWx({ api: mpApi({ 'POST /session': linked }) });
    await launch(wx);
    const p = await start(page('settings'));
    await p.unlink();
    expect(wx.named('setClipboardData')[0].opts.data).toBe('https://praetor-tunnel.trycloudflare.com/settings');
    expect(wx.named('showModal')[0].opts.content).toMatch(/passkey/);
  });

  it('hides the SOTER probe in release builds', async () => {
    const wx = fakeWx({ api: mpApi({ 'POST /session': linked }), env: 'release' });
    await launch(wx);
    const p = await start(page('settings'));
    expect(p.data.showSupport).toBe(false);
  });
});

describe('support (Alex\'s SOTER probe)', () => {
  it('shows what the phone offers SOTER, sends nothing', async () => {
    const wx = fakeWx({ api: mpApi({ 'POST /session': linked }), supportMode: ['facial'] });
    await launch(wx);
    const p = await start(page('support'));
    expect(JSON.parse(p.data.out)).toMatchObject({ support: { supportMode: ['facial'] }, enrolled: { facial: { isEnrolled: true }, fingerPrint: { isEnrolled: false } } });
    expect(wx.named('request').map((c) => c.opts.url)).toEqual(['https://praetor-tunnel.trycloudflare.com/mp/session']);
  });
});
