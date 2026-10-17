// alipayplus-mock (spec 05): the Alipay+ ACQP endpoints the official ant-intl-alipayplus-mcp server calls, with its
// request signing (V7): "POST <path>\n<clientId>.<time>.<body>", RSA PKCS#1 v1.5 SHA-256, base64 then URL-encoded.
// Responses are signed with the gateway test key and carry the lowercase headers the client requires. Scripted
// outcomes: in process then success; an order description containing FAIL, or a merchant id starting with FAIL (the
// demo's decline-test merchant), fails. Labelled a mock everywhere.
import { createPrivateKey, createPublicKey, createSign, createVerify, randomUUID } from 'node:crypto';
import express from 'express';

export const signContent = (method: string, path: string, clientId: string, time: string, body: string) => `${method} ${path}\n${clientId}.${time}.${body}`;

const urlEncode = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');

export function createGateway(d: { merchantPublicKey: string; gatewayPrivateKey: string }) {
  const merchantKey = createPublicKey({ key: Buffer.from(d.merchantPublicKey, 'base64'), format: 'der', type: 'spki' });
  const gatewayKey = createPrivateKey({ key: Buffer.from(d.gatewayPrivateKey, 'base64'), format: 'der', type: 'pkcs8' });
  const payments = new Map<string, { paymentId: string; amount: unknown; fail: boolean }>();
  const app = express();
  app.use(express.text({ type: '*/*', limit: '64kb' }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.post('*', (req, res) => {
    // The client sends the absolute URL as the request target (V7): only its path counts.
    const path = new URL(req.originalUrl, 'https://alipayplus-mock').pathname;
    const raw = typeof req.body === 'string' ? req.body : '';
    const clientId = req.header('client-id') ?? '';
    const time = req.header('request-time') ?? '';
    const sig = /signature=([^,]+)/.exec(req.header('signature') ?? '')?.[1];
    const valid = !!sig && createVerify('RSA-SHA256').update(signContent('POST', path, clientId, time, raw)).verify(merchantKey, Buffer.from(decodeURIComponent(sig.replace(/\+/g, ' ')), 'base64'));
    if (!valid) return res.status(401).json({ result: { resultCode: 'INVALID_SIGNATURE', resultStatus: 'F' } });
    const body = JSON.parse(raw || '{}') as { paymentRequestId?: string; paymentAmount?: unknown; order?: { orderDescription?: string; merchant?: { referenceMerchantId?: string } } };
    const rid = body.paymentRequestId ?? '';
    let out: Record<string, unknown>;
    if (path.endsWith('/payments/pay')) {
      const p = { paymentId: randomUUID().replace(/-/g, ''), amount: body.paymentAmount, fail: /FAIL/.test(body.order?.orderDescription ?? '') || /^FAIL/.test(body.order?.merchant?.referenceMerchantId ?? '') };
      payments.set(rid, p);
      out = { result: { resultCode: 'PAYMENT_IN_PROCESS', resultStatus: 'U', resultMessage: 'payment in process' }, paymentId: p.paymentId, paymentRequestId: rid };
    } else if (path.endsWith('/payments/inquiryPayment')) {
      const p = payments.get(rid);
      out = !p
        ? { result: { resultCode: 'ORDER_NOT_EXIST', resultStatus: 'F', resultMessage: 'order not exist' } }
        : { result: { resultCode: 'SUCCESS', resultStatus: 'S', resultMessage: 'success' }, paymentStatus: p.fail ? 'FAIL' : 'SUCCESS', paymentRequestId: rid, paymentId: p.paymentId, paymentAmount: p.amount, paymentTime: new Date().toISOString() };
    } else {
      out = { result: { resultCode: 'UNKNOWN_EXCEPTION', resultStatus: 'U', resultMessage: `not mocked: ${path}` } };
    }
    const rsp = JSON.stringify(out);
    const rt = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
    const rsig = createSign('RSA-SHA256').update(signContent('POST', path, clientId, rt, rsp)).sign(gatewayKey).toString('base64');
    res.set({ signature: `algorithm=RSA256,keyVersion=1,signature=${urlEncode(rsig)}`, 'response-time': rt, 'client-id': clientId, 'content-type': 'application/json; charset=UTF-8' });
    res.send(rsp);
  });
  return app;
}
