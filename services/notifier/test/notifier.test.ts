import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { decisionText, recoveryText, refusalText, createNotifierApp } from '../src/app.js';
import { Reason, Tier } from '@praetor/protocol';

describe('messages (spec 05 notifier wording)', () => {
  it('a refusal says what was blocked and why, with the links', () => {
    expect(refusalText({ reason: Reason.SANCTIONED, tier: Tier.T0_NEVER, target: '0x0000000000000000000000000000000000000bad', txHash: '0xaa', explorer: 'https://x' }))
      .toBe('Blocked: payee on the sanctions list. https://x/tx/0xaa');
  });
  it('a recovery scheduled on Base tells the owner when the keys go and how to stop it (F10, 48 h to cancel)', () => {
    expect(recoveryText({ executableAt: 1_800_172_800n, txHash: '0xdd', explorer: 'https://x' }))
      .toBe('Recovery of your account scheduled: your passkeys will be replaced after 2027-01-17 08:00 UTC. Not you? Cancel it now in Settings with one of your passkeys. https://x/tx/0xdd');
  });
  it('a T1 rebalance or payment is reported once', () => {
    expect(decisionText({ kind: 'rebalance', usd: '650.00', asset: 'gold', txHash: '0xbb', explorer: 'https://x' })).toBe('Agent sold 650.00 USD of gold. https://x/tx/0xbb');
    expect(decisionText({ kind: 'payment', usd: '12.50', asset: 'USDC', txHash: '0xcc', explorer: 'https://x' })).toBe('Agent paid 12.50 USDC. https://x/tx/0xcc');
    // The local fork has no public explorer (issue #9): the hash, marked local.
    expect(decisionText({ kind: 'payment', usd: '12.50', asset: 'USDC', txHash: '0xcc', explorer: null })).toBe('Agent paid 12.50 USDC. tx 0xcc (local fork, no public explorer)');
  });
});

describe('notifier API', () => {
  const sent: { channel: string; to: string; text: string }[] = [];
  const app = createNotifierApp({
    token: 't'.repeat(40),
    channels: [{ name: 'wechat-oa-sink', send: async (n) => { sent.push({ channel: 'wechat-oa-sink', to: n.account, text: n.text }); } }],
  });
  const auth = { authorization: `Bearer ${'t'.repeat(40)}` };

  it('fans a notification out to every channel and keeps it in the account outbox', async () => {
    await request(app).post('/notify').send({ account: '0x00000000000000000000000000000000000c0ffe', kind: 'approval', text: 'Approve 300 USDC to Café Lumen?' }).expect(401);
    await request(app).post('/notify').set(auth).send({ account: '0x00000000000000000000000000000000000c0ffe', kind: 'approval', text: 'Approve 300 USDC to Café Lumen?', link: 'https://p/approve/1' }).expect(202);
    expect(sent).toEqual([{ channel: 'wechat-oa-sink', to: '0x00000000000000000000000000000000000c0ffe', text: 'Approve 300 USDC to Café Lumen?' }]);
    const out = await request(app).get('/outbox/0x00000000000000000000000000000000000c0ffe').set(auth).expect(200);
    expect(out.body.items[0]).toMatchObject({ kind: 'approval', text: 'Approve 300 USDC to Café Lumen?', channels: ['wechat-oa-sink'] });
  });
});
