// Decodes the calls an approval covers so the screen shows what is really signed (spec 05 "what you see is what you
// sign"): the full payee address and the exact amount, read from the calldata itself, never from the api's summary.
// Only exact ABI encodings of the calls the agent builds decode; anything else is shown as a raw call.
const i18n = require('./i18n.js');
const format = require('./format.js');
const protocol = require('./protocol.js');

const SELECTORS = { '0xa9059cbb': 'transfer', '0x095ea7b3': 'approve', '0xfe029156': 'swap', '0x17f1f2a1': 'pay' };
const ARGS = {
  transfer: ['address', 'uint256'],
  approve: ['address', 'uint256'],
  swap: ['address', 'address', 'uint256', 'uint256'],
  pay: ['address', 'uint256', 'uint8', 'bytes32', 'bytes32'],
};
const RAILS = ['USDC_DIRECT', 'ALIPAY_PLUS', 'WECHAT_PAY'];

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

function tokenOf(address, cfg) {
  if (same(address, cfg.usdc)) return { symbol: 'USDC', decimals: 6 };
  if (same(address, cfg.txau)) return { symbol: 'tXAU', decimals: 18 };
  if (same(address, cfg.txag)) return { symbol: 'tXAG', decimals: 18 };
  return null;
}

function decodeArgs(data, types) {
  if (typeof data !== 'string' || !/^0x[0-9a-fA-F]*$/.test(data)) return null;
  const body = data.slice(10).toLowerCase();
  if (body.length !== 64 * types.length) return null;
  const out = [];
  for (let i = 0; i < types.length; i++) {
    const w = body.slice(64 * i, 64 * i + 64);
    if (types[i] === 'address') {
      if (!/^0{24}/.test(w)) return null;
      out.push(protocol.checksumAddress(`0x${w.slice(24)}`));
    } else if (types[i] === 'uint8') {
      const n = BigInt(`0x${w}`);
      if (n > BigInt(255)) return null;
      out.push(Number(n));
    } else if (types[i] === 'uint256') out.push(BigInt(`0x${w}`).toString());
    else out.push(`0x${w}`);
  }
  return out;
}

function decodeCall(call, cfg) {
  const base = { target: call.to, value: String(call.value), selector: String(call.data).slice(0, 10).toLowerCase() };
  const name = SELECTORS[base.selector];
  const a = name ? decodeArgs(call.data, ARGS[name]) : null;
  if (!a) return Object.assign(base, { kind: 'unknown' });
  if (name === 'transfer') return Object.assign(base, { kind: 'transfer', token: tokenOf(call.to, cfg), to: a[0], amount: a[1] });
  if (name === 'approve') {
    const spenderName = same(a[0], cfg.treasuryDesk) ? 'desk' : same(a[0], cfg.payoutRail) ? 'rail' : null;
    return Object.assign(base, { kind: 'approve', token: tokenOf(call.to, cfg), spender: a[0], spenderName, amount: a[1] });
  }
  if (name === 'swap') return Object.assign(base, { kind: 'swap', tokenIn: tokenOf(a[0], cfg), tokenInAddress: a[0], tokenOut: tokenOf(a[1], cfg), tokenOutAddress: a[1], amountIn: a[2], minOut: a[3] });
  if (RAILS[a[2]] === undefined) return Object.assign(base, { kind: 'unknown' });
  return Object.assign(base, { kind: 'payout', partner: a[0], amount: a[1], rail: RAILS[a[2]], merchantRef: a[3], paymentRef: a[4] });
}

/** One sentence for the screen (full addresses) or the Face ID prompt (short: true). */
function describe(lang, d, opts) {
  const addr = (x) => (opts && opts.short ? format.shortAddress(x) : x);
  const sym = (tok, address) => (tok ? tok.symbol : i18n.t(lang, 'call.token', { address: addr(address) }));
  const amt = (v, tok) => format.units(v, tok ? tok.decimals : 0);
  let s;
  if (d.kind === 'transfer') s = i18n.t(lang, 'call.transfer', { amount: amt(d.amount, d.token), token: sym(d.token, d.target), to: addr(d.to) });
  else if (d.kind === 'approve') {
    const spender = d.spenderName ? i18n.t(lang, `call.${d.spenderName}`) : addr(d.spender);
    s = i18n.t(lang, 'call.approve', { spender, amount: amt(d.amount, d.token), token: sym(d.token, d.target) });
  } else if (d.kind === 'swap') {
    s = i18n.t(lang, 'call.swap', { amountIn: amt(d.amountIn, d.tokenIn), tokenIn: sym(d.tokenIn, d.tokenInAddress), minOut: amt(d.minOut, d.tokenOut), tokenOut: sym(d.tokenOut, d.tokenOutAddress) });
  } else if (d.kind === 'payout') s = i18n.t(lang, 'call.payout', { amount: format.units(d.amount, 6), rail: i18n.t(lang, `rail.${d.rail}`) });
  else s = i18n.t(lang, 'call.unknown', { selector: d.selector, to: addr(d.target) });
  if (d.value !== '0') s += ` ${i18n.t(lang, 'call.value', { value: d.value })}`;
  return s;
}

module.exports = { SELECTORS, decodeCall, describe, tokenOf };
