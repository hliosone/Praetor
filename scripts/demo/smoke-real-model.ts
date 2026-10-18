// One turn with the real model (not a test: the product path, spec 05). A fresh account is onboarded, given a named
// payee, and its agent is asked to pay it. Prints what the agent did.
import { agentChat, bootstrapConsortium, createAccount, ensureDeskLiquidity, fund, labelAddress, onboard, setDemoPrices, setPayeeLabels, stack } from './lib.js';

const s = stack();
await bootstrapConsortium(s);
await setDemoPrices(s);
await ensureDeskLiquidity(s);
const acc = await createAccount(s, `smoke-${Date.now()}`);
await onboard(s, acc, undefined, { scripted: false });
await fund(s, acc);
await setPayeeLabels(s, acc.address, [{ address: labelAddress('cafe'), label: 'Café Lumen' }]);
const t0 = Date.now();
const t = await agentChat(s, acc.address, process.argv[2] ?? 'Pay the café 12.50');
console.log(JSON.stringify({ account: acc.address, seconds: Math.round((Date.now() - t0) / 1000), text: t.text, tools: t.tools.map((x) => ({ tool: x.tool, status: x.status, output: String(x.output).slice(0, 160) })) }, null, 2));
