// wechatpay-mock (spec 05): a minimal JSAPI-like order and its query, for the WeChat Pay payout rail. Mock only.
import { randomBytes } from 'node:crypto';
import express from 'express';

export function createWechatPay() {
  const orders = new Map<string, { total: number; currency: string; fail: boolean; transaction_id: string }>();
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.post('/v3/pay/transactions/jsapi', (req, res) => {
    const b = req.body as { out_trade_no?: string; description?: string; amount?: { total?: number; currency?: string } };
    if (!b.out_trade_no || !Number.isInteger(b.amount?.total)) return res.status(400).json({ code: 'PARAM_ERROR' });
    orders.set(b.out_trade_no, { total: b.amount!.total!, currency: b.amount?.currency ?? 'USD', fail: /FAIL/.test(b.description ?? ''), transaction_id: `42${randomBytes(12).toString('hex')}` });
    res.json({ prepay_id: `wx${randomBytes(14).toString('hex')}` });
  });
  app.get('/v3/pay/transactions/out-trade-no/:no', (req, res) => {
    const o = orders.get(req.params.no);
    if (!o) return res.status(404).json({ code: 'ORDER_NOT_EXIST' });
    res.json({ out_trade_no: req.params.no, transaction_id: o.transaction_id, trade_state: o.fail ? 'PAYERROR' : 'SUCCESS', amount: { total: o.total, currency: o.currency } });
  });
  return app;
}
