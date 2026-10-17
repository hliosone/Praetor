// Requests as the api serves them, built with packages/protocol (an independent implementation of spec 02).
import { encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256 } from 'viem';
import { callHash, digest, praetorDomain, OwnerActionKind } from '@praetor/protocol';

export const ACCOUNT = '0x00000000000000000000000000000000000c0ffe';
export const HOOK = '0x00000000000000000000000000000000000000aa';
export const CAFE = '0x1111111111111111111111111111111111111111';
export const NOW = 1_800_000_000;
export const CFG = {
  chainId: 84532, domainName: 'Praetor-local', mandateHook: HOOK,
  usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', txau: '0x00000000000000000000000000000000000000a2', txag: '0x00000000000000000000000000000000000000a3',
  treasuryDesk: '0x00000000000000000000000000000000000000d1', payoutRail: '0x00000000000000000000000000000000000000e1',
};

export function approvalView(over = {}) {
  const call = { to: CFG.usdc, value: '0', data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [CAFE, 300_000_000n] }) };
  const ch = callHash({ account: ACCOUNT, target: call.to, value: 0n, data: call.data });
  const tier2 = { account: ACCOUNT, callHash: ch, nonce: '1311768467463790320', expiresAt: String(NOW + 900) };
  const d = digest(praetorDomain(CFG.domainName, HOOK), 'Tier2Approval', { ...tier2, nonce: BigInt(tier2.nonce), expiresAt: BigInt(tier2.expiresAt) });
  return { id: 'a1', state: 'pending', reason: 'UNKNOWN_PAYEE', summary: 'Pay 3 USDC to Landlord', digest: d, soterChallenge: d.slice(2), calls: [call], tier2, channel: null, registerTx: null, executeTx: null, ...over };
}

export function linkView(over = {}) {
  const linkNonce = keccak256('0x0bad');
  const payloadHash = keccak256(encodeAbiParameters([{ type: 'bytes32' }], [linkNonce]));
  const ownerAction = { account: ACCOUNT, action: OwnerActionKind.LINK_WECHAT, payloadHash, nonce: '42', expiresAt: String(NOW + 600), fiscoRef: `0x${'00'.repeat(32)}` };
  const d = digest(praetorDomain(CFG.domainName, HOOK), 'OwnerAction', { ...ownerAction, nonce: 42n, expiresAt: BigInt(ownerAction.expiresAt) });
  return { account: ACCOUNT, ownerAction, linkNonce, digest: d, soterChallenge: d.slice(2), state: 'waiting', ...over };
}

export const portfolio = {
  totalUsd6: '10000000000',
  assets: [
    { symbol: 'USDC', token: CFG.usdc, balance: '5300000000', valueUsd6: '5300000000', weightBps: 5300, demoPrice: false, band: { token: CFG.usdc, minBps: 4000, targetBps: 5500, maxBps: 6000 } },
    { symbol: 'tXAU', token: CFG.txau, balance: '1', valueUsd6: '3200000000', weightBps: 3200, demoPrice: true, band: { token: CFG.txau, minBps: 2000, targetBps: 3000, maxBps: 3500 } },
    { symbol: 'tXAG', token: CFG.txag, balance: '1', valueUsd6: '1500000000', weightBps: 1500, demoPrice: true, band: { token: CFG.txag, minBps: 0, targetBps: 1500, maxBps: 1500 } },
  ],
};
export const status = (effective = 'ACTIVE') => ({ effective, heartbeatValidUntil: String(NOW + 600), now: String(NOW) });
export const activity = {
  items: [
    { kind: 'decision', reason: 'OK', tier: 'T1_AUTONOMOUS', target: CFG.usdc, txHash: `0x${'aa'.repeat(32)}`, valueUsd6: '12500000' },
    { kind: 'refusal', reason: 'SANCTIONED', tier: 'T0_NEVER', target: CFG.usdc, txHash: `0x${'bb'.repeat(32)}` },
    { kind: 'refusal', reason: 'UNKNOWN_PAYEE', tier: 'T2_HUMAN', target: CFG.usdc, txHash: `0x${'cc'.repeat(32)}` },
  ],
};

/** The api behind /mp: a map of "METHOD /path" (query included when given) to handlers. */
export function mpApi(routes) {
  return (opts) => {
    const u = new URL(opts.url);
    if (!u.pathname.startsWith('/mp/')) return { statusCode: 404, data: { error: 'not under /mp' } };
    const path = u.pathname.slice(3);
    const h = routes[`${opts.method} ${path}${u.search}`] || routes[`${opts.method} ${path}`];
    if (!h) return { statusCode: 404, data: { error: `no route ${opts.method} ${path}${u.search}` } };
    const r = h(opts);
    return r !== null && typeof r === 'object' && 'statusCode' in r ? r : { statusCode: 200, data: r };
  };
}
