import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createPrivateKey, createPublicKey, createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createGateway, signContent } from '../src/gateway.js';

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { priv: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
};
const merchant = pair();
const gateway = pair();
const priv = (b64: string) => createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' });
const pub = (b64: string) => createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });

/** A request signed the way ant-intl-alipayplus-mcp 1.0.1 signs it (V7). */
function signed(path: string, body: object, merchantKey = merchant.priv) {
  const raw = JSON.stringify(body);
  const time = '2026-10-17T10:00:00+00:00';
  const s = createSign('RSA-SHA256').update(signContent('POST', path, 'CLIENT', time, raw)).sign(priv(merchantKey)).toString('base64');
  return { raw, headers: { 'content-type': 'application/json; charset=UTF-8', 'client-id': 'CLIENT', 'request-time': time, signature: `algorithm=RSA256,keyVersion=1,signature=${encodeURIComponent(s).replace(/%20/g, '+')}` } };
}
const app = () => createGateway({ merchantPublicKey: merchant.pub, gatewayPrivateKey: gateway.priv });

/** The official client sends the absolute URL as the request target (V7), which supertest cannot do. */
async function absolutePost(a: ReturnType<typeof app>, url: string, headers: Record<string, string>, raw: string) {
  const server = a.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    return await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: url, headers }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
      });
      req.on('error', reject);
      req.end(raw);
    });
  } finally {
    server.close();
  }
}

describe('Alipay+ ACQP mock (what the official MCP server calls)', () => {
  it('pay is in process, then inquiry succeeds; responses carry the lowercase signed headers the client requires', async () => {
    const a = app();
    const p = signed('/aps/api/v1/payments/pay', { paymentRequestId: 'r1', paymentAmount: { currency: 'USD', value: 120000 } });
    const r1 = await absolutePost(a, 'https://alipayplus-mock/aps/api/v1/payments/pay', p.headers, p.raw);
    expect(r1.status).toBe(200);
    expect(r1.body.result.resultCode).toBe('PAYMENT_IN_PROCESS');
    const q = signed('/aps/api/v1/payments/inquiryPayment', { paymentRequestId: 'r1' });
    const r2 = await request(a).post('/aps/api/v1/payments/inquiryPayment').set(q.headers).send(q.raw).expect(200);
    expect(r2.body).toMatchObject({ paymentStatus: 'SUCCESS', paymentAmount: { currency: 'USD', value: 120000 } });
    const sig = decodeURIComponent(/signature=([^,]+)$/.exec(r2.headers.signature!)![1]!.replace(/\+/g, ' '));
    const ok = createVerify('RSA-SHA256').update(signContent('POST', '/aps/api/v1/payments/inquiryPayment', 'CLIENT', r2.headers['response-time']!, r2.text)).verify(pub(gateway.pub), Buffer.from(sig, 'base64'));
    expect(ok).toBe(true);
    expect(r2.headers['client-id']).toBe('CLIENT');
  });

  it('refuses a request signed with another key', async () => {
    const p = signed('/aps/api/v1/payments/pay', { paymentRequestId: 'r2', paymentAmount: { currency: 'USD', value: 1 } }, pair().priv);
    await request(app()).post('/aps/api/v1/payments/pay').set(p.headers).send(p.raw).expect(401);
  });

  it('scripted failure: a merchant whose id starts with FAIL is declined at inquiry (the partner then refunds)', async () => {
    const a = app();
    const p = signed('/aps/api/v1/payments/pay', { paymentRequestId: 'r4', paymentAmount: { currency: 'USD', value: 5 }, order: { orderDescription: 'rent', merchant: { referenceMerchantId: 'FAIL00000001' } } });
    await request(a).post('/aps/api/v1/payments/pay').set(p.headers).send(p.raw).expect(200);
    const q = signed('/aps/api/v1/payments/inquiryPayment', { paymentRequestId: 'r4' });
    expect((await request(a).post('/aps/api/v1/payments/inquiryPayment').set(q.headers).send(q.raw)).body.paymentStatus).toBe('FAIL');
  });

  it('scripted failure: a description containing FAIL is refused at inquiry', async () => {
    const a = app();
    const p = signed('/aps/api/v1/payments/pay', { paymentRequestId: 'r3', paymentAmount: { currency: 'USD', value: 5 }, order: { orderDescription: 'rent FAIL' } });
    await request(a).post('/aps/api/v1/payments/pay').set(p.headers).send(p.raw).expect(200);
    const q = signed('/aps/api/v1/payments/inquiryPayment', { paymentRequestId: 'r3' });
    expect((await request(a).post('/aps/api/v1/payments/inquiryPayment').set(q.headers).send(q.raw)).body.paymentStatus).toBe('FAIL');
  });
});
