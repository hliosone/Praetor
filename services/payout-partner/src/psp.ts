// The two PSP clients. Alipay+: the official MCP server ant-intl-alipayplus-mcp 1.0.1 over stdio, launched with every
// one of its 11 variables set (a missing one prints to stdout and breaks stdio, V7) and mcp pinned to 1.29.1 (an
// unpinned mcp crashes it). Its failures come back as text: anything that is not JSON is an unknown outcome.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Merchant, Psp, PspResult } from './partner.js';

export type AlipayConfig = { gatewayUrl: string; clientId: string; merchantPrivateKey: string; alipayPublicKey: string; publicUrl: string; command?: string; args?: string[] };

export function alipayPlus(c: AlipayConfig): Psp {
  const clients = new Map<string, Promise<Client>>();
  const clientFor = (m: Merchant) => {
    let p = clients.get(m.id);
    if (!p) {
      p = (async () => {
        const transport = new StdioClientTransport({
          command: c.command ?? 'uvx',
          args: c.args ?? ['--offline', '--from', 'ant-intl-alipayplus-mcp==1.0.1', '--with', 'mcp[cli]==1.29.1', 'ant-intl-alipayplus-mcp'],
          env: {
            PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '/tmp', UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? '', UV_TOOL_DIR: process.env.UV_TOOL_DIR ?? '',
            GATEWAY_URL: c.gatewayUrl, CLIENT_ID: c.clientId, MERCHANT_PRIVATE_KEY: c.merchantPrivateKey, ALIPAY_PUBLIC_KEY: c.alipayPublicKey,
            PAYMENT_REDIRECT_URL: `${c.publicUrl}/`, PAYMENT_NOTIFY_URL: `${c.publicUrl}/notify`, SETTLEMENT_CURRENCY: 'USD',
            MERCHANT_NAME: m.name, MERCHANT_ID: m.id, MERCHANT_MCC: m.mcc, MERCHANT_REGION: m.region,
          },
          stderr: 'ignore',
        });
        const client = new Client({ name: 'praetor-payout-partner', version: '0.1.0' });
        await client.connect(transport);
        return client;
      })();
      p.catch(() => clients.delete(m.id));
      clients.set(m.id, p);
    }
    return p;
  };
  const call = async (m: Merchant, name: string, args: Record<string, unknown>): Promise<Record<string, any> | null> => {
    const r = (await (await clientFor(m)).callTool({ name, arguments: args })) as { content?: { type: string; text?: string }[] };
    const text = r.content?.find((x) => x.type === 'text')?.text ?? '';
    try {
      return JSON.parse(text) as Record<string, any>;
    } catch {
      return null;
    }
  };
  const query = async (m: Merchant, paymentRequestId: string): Promise<PspResult> => {
    const j = await call(m, 'query_payment', { payment_request_id: paymentRequestId });
    if (!j) return { state: 'UNKNOWN' };
    if (j.paymentStatus === 'SUCCESS') return { state: 'SUCCESS', settlementRef: String(j.paymentId ?? paymentRequestId) };
    if (j.paymentStatus === 'FAIL' || j.result?.resultStatus === 'F') return { state: 'FAIL' };
    return { state: 'UNKNOWN' };
  };
  return {
    async pay(m, r) {
      const j = await call(m, 'create_payment', { payment_request_id: r.paymentRequestId, order_amount_currency: 'USD', order_amount_value: r.minor, order_description: r.description });
      if (j?.result?.resultStatus === 'F') return { state: 'FAIL' };
      return query(m, r.paymentRequestId);
    },
    query,
  };
}

export function wechatPay(base: string): Psp {
  const query = async (_m: Merchant, id: string): Promise<PspResult> => {
    const r = await fetch(`${base}/v3/pay/transactions/out-trade-no/${encodeURIComponent(id)}`).catch(() => null);
    if (!r || !r.ok) return { state: 'UNKNOWN' };
    const j = (await r.json()) as { trade_state?: string; transaction_id?: string };
    return j.trade_state === 'SUCCESS' ? { state: 'SUCCESS', settlementRef: j.transaction_id } : j.trade_state === 'PAYERROR' ? { state: 'FAIL' } : { state: 'UNKNOWN' };
  };
  return {
    async pay(m, r) {
      await fetch(`${base}/v3/pay/transactions/jsapi`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ out_trade_no: r.paymentRequestId, description: r.description, amount: { total: r.minor, currency: 'USD' } }) });
      return query(m, r.paymentRequestId);
    },
    query,
  };
}
