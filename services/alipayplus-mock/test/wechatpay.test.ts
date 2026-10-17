import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createWechatPay } from '../src/wechatpay.js';

describe('WeChat Pay mock (JSAPI-like order + query)', () => {
  it('an order is paid, and its query says SUCCESS; FAIL in the description fails', async () => {
    const a = createWechatPay();
    const r = await request(a).post('/v3/pay/transactions/jsapi').send({ out_trade_no: 'p1', description: 'electricity', amount: { total: 4250, currency: 'USD' } }).expect(200);
    expect(r.body.prepay_id).toMatch(/^wx/);
    expect((await request(a).get('/v3/pay/transactions/out-trade-no/p1').expect(200)).body).toMatchObject({ out_trade_no: 'p1', trade_state: 'SUCCESS', amount: { total: 4250 } });
    await request(a).post('/v3/pay/transactions/jsapi').send({ out_trade_no: 'p2', description: 'FAIL', amount: { total: 1, currency: 'USD' } }).expect(200);
    expect((await request(a).get('/v3/pay/transactions/out-trade-no/p2')).body.trade_state).toBe('PAYERROR');
    await request(a).get('/v3/pay/transactions/out-trade-no/nope').expect(404);
  });
});
