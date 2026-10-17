import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { merchantRef, Rail } from '@praetor/protocol';
import { createPartnerApp } from '../src/app.js';
import { DIRECTORY, merchantOf } from '../src/merchants.js';

const PARTNER = '0x00000000000000000000000000000000000000aa';

describe('payout partner HTTP (internal network)', () => {
  it('publishes its merchant directory: the api turns a merchant code into (partner, rail, merchantRef)', async () => {
    const r = await request(createPartnerApp({ partner: PARTNER, healthy: () => true, processed: () => [] })).get('/merchants').expect(200);
    expect(r.body.partner).toBe(PARTNER);
    expect(r.body.merchants).toEqual(expect.arrayContaining([
      { code: 'KOWLOON-LETTINGS', name: 'Kowloon Lettings (mock)', rail: Rail.ALIPAY_PLUS, merchantRef: merchantRef('KOWLOON-LETTINGS') },
      { code: 'HK-ELECTRIC', name: 'HK Electric (mock)', rail: Rail.WECHAT_PAY, merchantRef: merchantRef('HK-ELECTRIC') },
    ]));
    // PSP account ids stay with the partner.
    expect(JSON.stringify(r.body)).not.toMatch(/M0000000042/);
  });

  it('has a decline-test merchant whose PSP account is scripted to fail at the mock gateway', () => {
    const m = DIRECTORY.find((x) => x.code === 'DECLINE-TEST')!;
    expect(merchantOf(m.merchantRef)).toMatchObject({ rail: Rail.ALIPAY_PLUS, id: expect.stringMatching(/^FAIL/) });
  });

  it('reports health from its watch loop and lists processed payouts', async () => {
    const a = createPartnerApp({ partner: PARTNER, healthy: () => false, processed: () => [{ id: '3', result: 'SETTLED' }] });
    expect((await request(a).get('/health')).status).toBe(503);
    expect((await request(a).get('/payouts').expect(200)).body).toEqual({ processed: [{ id: '3', result: 'SETTLED' }] });
  });
});
