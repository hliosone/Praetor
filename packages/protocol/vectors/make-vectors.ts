// Golden vectors of spec 02, shared by the TS tests, the Solidity tests and the mini program bundle.
// Test-only keys: anvil default accounts 1 to 4 as bank, regulator, operator, attester (never members of any
// deployment, Q13). Deterministic: secp256k1 and P-256 signatures use RFC 6979, so a rerun gives the same files.
// Usage: pnpm --filter @praetor/protocol vectors
import { writeFileSync } from 'node:fs';
import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  types, encodeType, typehash, structHash, digest, praetorDomain, DOMAIN_NAMES, TEST_VERIFYING_CONTRACT, callHash, bindingHash,
  merchantRef, merchantKey, valueUsd6, encodePolicy, policyHash, validatePolicy, POLICY_RULES, ownerActionPayload,
  OwnerActionKind, OWNER_ACTION_KINDS, buildAuditChain, softPasskey, encodePasskeySignature, WEBAUTHN_AUTH_TUPLE, fiscoRef,
  sortSignatures, passkeyAuth, soterAuth, OWNER_AUTH_TUPLE, Status, RiskProfile, AssetKind, AssetStatus, Rail, OwnerActionKind as K,
  type PrimaryType, type MessageOf, type Policy,
} from '../src/index.js';

export const TEST_KEYS = {
  bank: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  regulator: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  operator: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  attester: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
} as const;
const signer = Object.fromEntries(Object.entries(TEST_KEYS).map(([k, v]) => [k, privateKeyToAccount(v)])) as Record<keyof typeof TEST_KEYS, ReturnType<typeof privateKeyToAccount>>;

export const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address;
const ACCOUNT = '0x000000000000000000000000000000000000a11c' as Address;
const AGENT = '0x00000000000000000000000000000000000a6e47' as Address;
const XAU = '0x00000000000000000000000000000000000000a1' as Address;
const XAG = '0x00000000000000000000000000000000000000a2' as Address;
const PARTNER = '0x00000000000000000000000000000000000000c1' as Address;
const FISCO_BOARD = '0x0000000000000000000000000000000000001001' as Address;
const NOW = 1_800_000_000n;
const DEADLINE = NOW + 3_600n;
const domain = praetorDomain(DOMAIN_NAMES.test, TEST_VERIFYING_CONTRACT);
const ref = (id: bigint) => fiscoRef(FISCO_BOARD, id);
const passkey = softPasskey('vector-owner');

export const linPolicy = (): Policy => ({
  autoCap: 200_000_000n, hardCap: 2_000_000_000n, dailyBudget: 500_000_000n, monthlyBudget: 3_000_000_000n, dailyCount: 10,
  bufferUsdc: 1_000_000_000n,
  payees: ['0x00000000000000000000000000000000000000b1', '0x00000000000000000000000000000000000000b2', '0x00000000000000000000000000000000000000b3'],
  merchants: [merchantKey(PARTNER, merchantRef('KOWLOON-LETTINGS'))],
  bands: [
    { token: USDC, minBps: 4000, targetBps: 5500, maxBps: 6000 },
    { token: XAU, minBps: 2000, targetBps: 3000, maxBps: 3500 },
    { token: XAG, minBps: 0, targetBps: 1500, maxBps: 1500 },
  ],
  maxRebalancesPerDay: 1, maxTradeUsd: 1_000_000_000n, maxSlippageBps: 100, validUntil: NOW + 86_400n * 365n, soterEnabled: true,
});

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
const encodeMessage = <T extends PrimaryType>(t: T, m: MessageOf[T]): Hex =>
  encodeAbiParameters(types[t].map((f) => ({ name: f.name, type: f.type })), types[t].map((f) => (m as Record<string, unknown>)[f.name]) as never);

async function typedVector<T extends PrimaryType>(t: T, message: MessageOf[T], by: (keyof typeof TEST_KEYS)[]) {
  const d = digest(domain, t, message);
  const sigs = await Promise.all(by.map(async (who) => ({ who, signer: signer[who].address, sig: await signer[who].sign({ hash: d }) })));
  return json({
    primaryType: t, domain, encodeType: encodeType(t), typehash: typehash(t), message, encoded: encodeMessage(t, message),
    structHash: structHash(t, message), digest: d,
    signatures: sigs.map(({ who, signer: s, sig }) => ({ who, signer: s, sig })),
    sortedSigs: sortSignatures(sigs.map(({ signer: s, sig }) => ({ signer: s, sig }))),
  });
}

export async function buildVectors(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const t2: MessageOf['Tier2Approval'] = { account: ACCOUNT, callHash: callHash({ account: ACCOUNT, target: USDC, value: 0n, data: '0xa9059cbb' }), nonce: 0x1234_5678_9abc_def0n, expiresAt: NOW + 600n };
  const t2digest = digest(domain, 'Tier2Approval', t2);
  const policyPayload = ownerActionPayload({ kind: K.SET_POLICY, account: ACCOUNT, policy: linPolicy() });
  const ownerAction: MessageOf['OwnerAction'] = { account: ACCOUNT, action: K.SET_POLICY, payloadHash: policyPayload.payloadHash, nonce: 42n, expiresAt: NOW + 600n, fiscoRef: keccak256(toHex('fisco-tx:MandateChecked')) };
  const binding = bindingHash({ mpAppId: 'wx-test-app', openid: 'o-test-openid', uid: 'uid-test', cpuId: 'cpu-test' });
  const soter: MessageOf['SoterApproval'] = { account: ACCOUNT, digest: t2digest, bindingHash: binding, soterCounter: 7n, expiresAt: NOW + 600n };

  out['status-attestation'] = await typedVector('StatusAttestation', { account: ACCOUNT, status: Status.FROZEN, nonce: 1n, deadline: DEADLINE, fiscoRef: ref(1n) }, ['regulator']);
  out['heartbeat-attestation'] = await typedVector('HeartbeatAttestation', { epoch: 5n, validUntil: NOW + 180n, deadline: DEADLINE }, ['operator']);
  out['caps-attestation'] = await typedVector('CapsAttestation', { riskProfile: RiskProfile.BALANCED, perTxCap: 5_000_000_000n, dailyCap: 10_000_000_000n, monthlyCap: 50_000_000_000n, nonce: 1n, deadline: DEADLINE, fiscoRef: ref(2n) }, ['bank']);
  out['kya-attestation'] = await typedVector('KYAAttestation', {
    account: ACCOUNT, agentKey: AGENT, agentDidHash: keccak256(toHex('did:weid:101:0xagent')), kycCredentialHash: keccak256(toHex('kyc-cred')),
    mandateCredentialHash: keccak256(toHex('mandate-cred')), kycLevel: 2, riskProfile: RiskProfile.BALANCED, jurisdiction: '0x484b',
    agentMeasurement: keccak256(toHex('rtmr3')), validUntil: NOW + 86_400n * 365n, nonce: 1n, deadline: DEADLINE, fiscoRef: ref(3n),
  }, ['bank']);
  out['asset-attestation'] = await typedVector('AssetAttestation', { asset: XAU, kind: AssetKind.TOKEN, status: AssetStatus.ACTIVE, maxWeightBps: 4000, nonce: 1n, deadline: DEADLINE, fiscoRef: ref(4n) }, ['bank']);
  out['sanctions-attestation'] = await typedVector('SanctionsAttestation', { target: PARTNER, listed: false, nonce: 2n, deadline: DEADLINE, fiscoRef: ref(5n) }, ['bank', 'regulator']);
  out['jurisdiction-attestation'] = await typedVector('JurisdictionAttestation', { jurisdiction: '0x434e', payoutBlocked: true, nonce: 1n, deadline: DEADLINE, fiscoRef: ref(6n) }, ['regulator']);
  out['attester-attestation'] = await typedVector('AttesterAttestation', { attester: signer.attester.address, measurement: keccak256(toHex('attester-rtmr3')), active: true, nonce: 1n, deadline: DEADLINE, fiscoRef: ref(7n) }, ['bank']);
  out['anchor-attestation'] = await typedVector('AnchorAttestation', { seq: 1n, head: keccak256(toHex('head-1')), fiscoBlock: 1234n, deadline: DEADLINE }, ['bank', 'operator']);
  out['standing-order'] = await typedVector('StandingOrder', { account: ACCOUNT, id: 1, payee: PARTNER, amount: 1_200_000_000n, period: 2_592_000, firstDue: NOW + 86_400n, rail: Rail.ALIPAY_PLUS, merchantRef: merchantRef('KOWLOON-LETTINGS') }, []);
  out['soter-approval'] = await typedVector('SoterApproval', soter, ['attester']);

  const t2v = (await typedVector('Tier2Approval', t2, [])) as Record<string, unknown>;
  const low = passkey.sign(t2digest);
  const high = passkey.sign(t2digest, { highS: true });
  out['tier2-approval'] = {
    ...t2v,
    passkey: json({ credIdHash: passkey.credIdHash, x: passkey.x, y: passkey.y }),
    passkeyAuth: json(low), passkeyAuthEncoded: encodeAbiParameters([WEBAUTHN_AUTH_TUPLE], [low]),
    passkeySignature: encodePasskeySignature(passkey.credIdHash, low),
    highSAuth: json(high), highSAuthEncoded: encodeAbiParameters([WEBAUTHN_AUTH_TUPLE], [high]),
  };

  const oa = (await typedVector('OwnerAction', ownerAction, ['bank'])) as Record<string, unknown>;
  const oaAuth = passkey.sign(oa.digest as Hex);
  const soterForOa: MessageOf['SoterApproval'] = { ...soter, digest: oa.digest as Hex, soterCounter: 8n };
  const soterSig = await signer.attester.sign({ hash: digest(domain, 'SoterApproval', soterForOa) });
  out['owner-action'] = {
    ...oa, payload: policyPayload.payload,
    passkeyOwnerAuth: encodeAbiParameters([OWNER_AUTH_TUPLE], [passkeyAuth(passkey.credIdHash, oaAuth)]),
    soterApproval: json(soterForOa), soterOwnerAuth: encodeAbiParameters([OWNER_AUTH_TUPLE], [soterAuth(soterForOa, soterSig)]),
  };

  out['callhash'] = json([
    { account: ACCOUNT, target: USDC, value: 0n, data: '0x' },
    { account: ACCOUNT, target: USDC, value: 0n, data: '0xa9059cbb00000000000000000000000000000000000000000000000000000000000000b1000000000000000000000000000000000000000000000000000000000bebc200' },
    { account: ACCOUNT, target: ACCOUNT, value: 0n, data: '0x9517e29f' },
    { account: ACCOUNT, target: XAU, value: 1n, data: '0x00' },
  ].map((c) => ({ ...c, callHash: callHash(c as never) })));

  out['identifiers'] = {
    binding: { mpAppId: 'wx-test-app', openid: 'o-test-openid', uid: 'uid-test', cpuId: 'cpu-test', bindingHash: binding },
    merchant: { merchantId: 'KOWLOON-LETTINGS', merchantRef: merchantRef('KOWLOON-LETTINGS'), partner: PARTNER, merchantKey: merchantKey(PARTNER, merchantRef('KOWLOON-LETTINGS')) },
    fiscoRef: { fiscoContract: FISCO_BOARD, proposalId: '1', fiscoRef: ref(1n) },
  };

  out['value-usd6'] = json([
    { amount: 1_000_000n, price8: 100_000_000n, decimals: 6 },
    { amount: 10n ** 18n, price8: 265_012_345_678n, decimals: 18 },
    { amount: 5n * 10n ** 17n, price8: 3_112_000_000n, decimals: 18 },
    { amount: 1n, price8: 1n, decimals: 18 },
    { amount: 2n ** 128n, price8: 100_000_000n, decimals: 6 },
    { amount: 2n ** 128n + 1n, price8: 100_000_000n, decimals: 6 },
    { amount: 1n, price8: 2n ** 128n, decimals: 6 },
    { amount: 1n, price8: 1n, decimals: 37 },
    { amount: 2n ** 128n, price8: 2n ** 128n - 1n, decimals: 36 },
  ].map((c) => {
    const v = valueUsd6(c.amount, c.price8, c.decimals);
    return { ...c, valueUsd6: v, refused: v === null };
  }));

  // One valid policy plus one breaking each rule, in rule order.
  const mutations: Record<string, (p: Policy) => void> = {
    OK: () => {},
    AUTO_CAP_GT_HARD_CAP: (p) => { p.autoCap = p.hardCap + 1n; },
    DAILY_GT_MONTHLY: (p) => { p.dailyBudget = p.monthlyBudget + 1n; },
    AMOUNT_TOO_LARGE: (p) => { p.bufferUsdc = 2n ** 128n + 1n; },
    TOO_MANY_PAYEES: (p) => { p.payees = Array.from({ length: 17 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}` as Address); },
    TOO_MANY_MERCHANTS: (p) => { p.merchants = Array.from({ length: 17 }, (_, i) => `0x${(i + 1).toString(16).padStart(64, '0')}` as Hex); },
    BAND_COUNT: (p) => { p.bands = []; },
    USDC_NOT_FIRST: (p) => { p.bands = [p.bands[1]!, p.bands[0]!, p.bands[2]!]; },
    BAND_ORDER: (p) => { p.bands[1]!.minBps = 3100; },
    TARGET_SUM: (p) => { p.bands[2]!.targetBps = 1400; },
    ZERO_ADDRESS: (p) => { p.payees[0] = '0x0000000000000000000000000000000000000000'; },
    DUPLICATE_PAYEE: (p) => { p.payees[1] = p.payees[0]!; },
    DUPLICATE_MERCHANT: (p) => { p.merchants = [p.merchants[0]!, p.merchants[0]!]; },
    DUPLICATE_TOKEN: (p) => { p.bands[2]!.token = XAU; },
    BPS_RANGE: (p) => { p.maxSlippageBps = 10_001; },
    EXPIRED: (p) => { p.validUntil = NOW; },
  };
  out['policy'] = json({
    now: NOW, usdc: USDC, rules: POLICY_RULES,
    cases: Object.entries(mutations).map(([name, mut]) => {
      const p = linPolicy();
      mut(p);
      const rule = validatePolicy(p, NOW, USDC);
      if (rule !== name) throw new Error(`policy case ${name} gave ${rule}`);
      return { name, rule: POLICY_RULES.indexOf(rule), policy: p, encoded: encodePolicy(p), policyHash: policyHash(p) };
    }),
  });

  const order = (out['standing-order'] as { message: MessageOf['StandingOrder'] }).message;
  const payloadArgs = [
    { kind: K.SET_POLICY, account: ACCOUNT, policy: linPolicy() },
    { kind: K.ADD_STANDING_ORDER, account: ACCOUNT, order: { ...order, amount: BigInt(order.amount), firstDue: BigInt(order.firstDue) } },
    { kind: K.CANCEL_STANDING_ORDER, account: ACCOUNT, id: 1 },
    { kind: K.LINK_WECHAT, account: ACCOUNT, linkNonce: keccak256(toHex('link-nonce')), proof: soter, attesterSig: (out['soter-approval'] as { signatures: { sig: Hex }[] }).signatures[0]!.sig },
    { kind: K.UNLINK_WECHAT, account: ACCOUNT, bindingHash: binding },
    { kind: K.SET_AGENT_KEY, account: ACCOUNT, agentKey: AGENT, validUntil: Number(NOW + 86_400n * 30n) },
    { kind: K.REVOKE_AGENT_KEY, account: ACCOUNT, agentKey: AGENT },
    { kind: K.PAUSE_AGENT, account: ACCOUNT },
    { kind: K.RESUME_AGENT, account: ACCOUNT },
    { kind: K.SET_OWNER_KEY, account: ACCOUNT, credIdHash: passkey.credIdHash, x: passkey.x, y: passkey.y },
    { kind: K.CANCEL_RECOVERY, account: ACCOUNT, recoveryPayloadHash: keccak256(toHex('recovery')) },
    { kind: K.MODULE_CHANGE, account: ACCOUNT, moduleCallData: '0x9517e29f0000000000000000000000000000000000000000000000000000000000000002' },
    { kind: K.REMOVE_PAYEE, account: ACCOUNT, payee: '0x00000000000000000000000000000000000000b2' },
    { kind: K.REMOVE_PAYEE, account: ACCOUNT, merchantKey: merchantKey(PARTNER, merchantRef('KOWLOON-LETTINGS')) },
  ] as const;
  out['owner-action-payloads'] = json(payloadArgs.map((a) => ({ kind: a.kind, name: OWNER_ACTION_KINDS[a.kind], args: a, ...ownerActionPayload(a as never) })));

  const chain = buildAuditChain([
    { seq: 0, account: ACCOUNT, kind: 'KYA', reason: 'OK', fiscoTx: keccak256(toHex('f0')), atMs: 1_800_000_000_000 },
    { seq: 1, account: ACCOUNT, kind: 'DECISION', reason: 'OK', tier: 'T1_AUTONOMOUS', callHash: t2.callHash, baseTx: keccak256(toHex('b1')), amountUsd6: '150000000', atMs: 1_800_000_060_000 },
    { seq: 2, account: ACCOUNT, kind: 'REFUSAL', reason: 'OVER_AUTO_CAP', tier: 'T2_HUMAN', callHash: t2.callHash, userOpHash: keccak256(toHex('u2')), amountUsd6: '450000000', atMs: 1_800_000_120_000 },
    { seq: 3, account: ACCOUNT, kind: 'APPROVAL', reason: 'OK', tier: 'T2_HUMAN', callHash: t2.callHash, atMs: 1_800_000_180_000 },
    { seq: 4, account: ACCOUNT, kind: 'PAYOUT_REQUESTED', reason: 'OK', payoutId: '1', paymentRef: keccak256(toHex('p4')), merchantRef: merchantRef('KOWLOON-LETTINGS'), amountUsd6: '1200000000', atMs: 1_800_000_240_000 },
  ]);
  out['audit-chain'] = json(chain);
  out['keys'] = json(Object.fromEntries(Object.entries(signer).map(([k, a]) => [k, a.address])));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const v = await buildVectors();
  for (const [name, data] of Object.entries(v)) writeFileSync(new URL(`./${name}.json`, import.meta.url), JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote ${Object.keys(v).length} vector files`);
}
