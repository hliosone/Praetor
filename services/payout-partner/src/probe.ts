// Integration probe (test/integration/payout-partner.test.ts): one payment through the official Alipay+ MCP server
// against alipayplus-mock, run inside the partner's image with its environment. Prints the PSP result as JSON.
import { merchantRef } from '@praetor/protocol';
import { alipayPlus } from './psp.js';
import { merchantOf } from './merchants.js';

const [code = '', minor = '0'] = process.argv.slice(2);
const m = merchantOf(merchantRef(code));
if (!m) throw new Error(`unknown merchant ${code}`);
const psp = alipayPlus({
  gatewayUrl: process.env.ALIPAYPLUS_GATEWAY_URL!, clientId: process.env.ALIPAYPLUS_CLIENT_ID ?? 'SANDBOX_PRAETOR_MOCK',
  merchantPrivateKey: process.env.ALIPAYPLUS_TEST_MERCHANT_PRIVATE_KEY!, alipayPublicKey: process.env.ALIPAYPLUS_TEST_GATEWAY_PUBLIC_KEY!,
  publicUrl: process.env.PUBLIC_URL ?? 'https://praetor.localhost', command: process.env.ALIPAYPLUS_MCP_COMMAND, args: [],
});
console.log(JSON.stringify(await psp.pay(m, { paymentRequestId: `probe-${Date.now()}`, minor: Number(minor), description: 'integration probe' })));
process.exit(0);
