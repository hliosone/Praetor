import { describe, it, expect } from 'vitest';
import { encodeAbiParameters, keccak256, toHex, hashTypedData, recoverTypedDataAddress, type Hex, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  callHash, bindingHash, merchantRef, merchantKey, valueUsd6, MAX_AMOUNT, digest, structHash, praetorDomain,
  TEST_VERIFYING_CONTRACT, sortSignatures, normalizeP256S, P256_N, ownerActionPayload, OwnerActionKind, Rail,
} from '../src/index.js';

const A = '0x1111111111111111111111111111111111111111' as Address;
const T = '0x2222222222222222222222222222222222222222' as Address;

describe('callHash', () => {
  it('is keccak256(abi.encode(account, 84532, target, value, keccak256(data)))', () => {
    const data = '0xa9059cbb' as Hex;
    const expected = keccak256(encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }],
      [A, 84532n, T, 0n, keccak256(data)]));
    expect(callHash({ account: A, target: T, value: 0n, data })).toBe(expected);
  });

  it('changes with every field', () => {
    const base = callHash({ account: A, target: T, value: 0n, data: '0x' });
    expect(callHash({ account: T, target: T, value: 0n, data: '0x' })).not.toBe(base);
    expect(callHash({ account: A, target: A, value: 0n, data: '0x' })).not.toBe(base);
    expect(callHash({ account: A, target: T, value: 1n, data: '0x' })).not.toBe(base);
    expect(callHash({ account: A, target: T, value: 0n, data: '0x00' })).not.toBe(base);
  });
});

describe('bindingHash and merchant keys', () => {
  it('hashes each raw identifier before encoding (raw ids never on-chain)', () => {
    const k = (s: string) => keccak256(toHex(s));
    const expected = keccak256(encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
      [k('wxapp'), k('openid-1'), k('uid-1'), k('cpu-1')]));
    expect(bindingHash({ mpAppId: 'wxapp', openid: 'openid-1', uid: 'uid-1', cpuId: 'cpu-1' })).toBe(expected);
  });

  it('merchantRef = keccak256(bytes(merchantId)); merchantKey = keccak256(abi.encode(partner, merchantRef))', () => {
    const ref = merchantRef('KOWLOON-LETTINGS-001');
    expect(ref).toBe(keccak256(toHex('KOWLOON-LETTINGS-001')));
    expect(merchantKey(T, ref)).toBe(keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [T, ref])));
  });
});

describe('valueUsd6', () => {
  it('is amount * price8 / 10^(decimals + 2), rounded down', () => {
    expect(valueUsd6(1_000_000n, 100_000_000n, 6)).toBe(1_000_000n);
    expect(valueUsd6(10n ** 18n, 265_012_345_678n, 18)).toBe(2_650_123_456n);
    expect(valueUsd6(1n, 1n, 18)).toBe(0n);
  });

  it('refuses amounts above 2^128 before any arithmetic', () => {
    expect(MAX_AMOUNT).toBe(2n ** 128n);
    expect(valueUsd6(2n ** 128n, 100_000_000n, 6)).toBe(2n ** 128n);
    expect(valueUsd6(2n ** 128n + 1n, 100_000_000n, 6)).toBeNull();
  });
});

describe('EIP-712 digest', () => {
  const domain = praetorDomain('Praetor-test', TEST_VERIFYING_CONTRACT);
  const msg = { account: A, status: 2, nonce: 1n, deadline: 1_800_000_000n, fiscoRef: keccak256('0x01') };

  it('matches viem hashTypedData and recovers the signer', async () => {
    const d = digest(domain, 'StatusAttestation', msg);
    const bank = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
    const sig = await bank.sign({ hash: d });
    expect(await recoverTypedDataAddress({
      domain, primaryType: 'StatusAttestation', message: msg, signature: sig,
      types: { StatusAttestation: [
        { name: 'account', type: 'address' }, { name: 'status', type: 'uint8' }, { name: 'nonce', type: 'uint64' },
        { name: 'deadline', type: 'uint64' }, { name: 'fiscoRef', type: 'bytes32' }] },
    })).toBe(bank.address);
    expect(d).toBe(hashTypedData({ domain, primaryType: 'StatusAttestation', message: msg, types: { StatusAttestation: [
      { name: 'account', type: 'address' }, { name: 'status', type: 'uint8' }, { name: 'nonce', type: 'uint64' },
      { name: 'deadline', type: 'uint64' }, { name: 'fiscoRef', type: 'bytes32' }] } }));
  });

  it('differs between environments (domain name separation)', () => {
    const live = digest(praetorDomain('Praetor', TEST_VERIFYING_CONTRACT), 'StatusAttestation', msg);
    const local = digest(praetorDomain('Praetor-local', TEST_VERIFYING_CONTRACT), 'StatusAttestation', msg);
    expect(live).not.toBe(local);
    expect(structHash('StatusAttestation', msg)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('signature sets', () => {
  it('sorts signatures ascending by signer address and rejects duplicates', () => {
    const sigs = [
      { signer: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address, sig: '0x03' as Hex },
      { signer: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' as Address, sig: '0x01' as Hex },
      { signer: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address, sig: '0x02' as Hex },
    ];
    expect(sortSignatures(sigs)).toEqual(['0x01', '0x03', '0x02']);
    expect(() => sortSignatures([sigs[0]!, sigs[0]!])).toThrow(/duplicate/);
  });
});

describe('P-256 low-s', () => {
  it('maps a high s to n - s and keeps a low s', () => {
    expect(normalizeP256S(P256_N - 5n)).toBe(5n);
    expect(normalizeP256S(5n)).toBe(5n);
    expect(normalizeP256S(P256_N / 2n)).toBe(P256_N / 2n);
    expect(normalizeP256S(P256_N / 2n + 1n)).toBe(P256_N - (P256_N / 2n + 1n));
  });
});

describe('owner action payloads (spec 02 table)', () => {
  it('PAUSE_AGENT and RESUME_AGENT carry 0x with payloadHash 0', () => {
    for (const kind of [OwnerActionKind.PAUSE_AGENT, OwnerActionKind.RESUME_AGENT] as const) {
      expect(ownerActionPayload({ kind, account: A })).toEqual({ payload: '0x', payloadHash: `0x${'0'.repeat(64)}` });
    }
  });

  it('REMOVE_PAYEE puts the uint8 tag first (Q11)', () => {
    const p = ownerActionPayload({ kind: OwnerActionKind.REMOVE_PAYEE, account: A, payee: T });
    expect(p.payload).toBe(encodeAbiParameters([{ type: 'uint8' }, { type: 'address' }], [0, T]));
    const m = ownerActionPayload({ kind: OwnerActionKind.REMOVE_PAYEE, account: A, merchantKey: keccak256('0x02') });
    expect(m.payload).toBe(encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }], [1, keccak256('0x02')]));
    expect(m.payloadHash).toBe(keccak256(m.payload));
  });

  it('ADD_STANDING_ORDER hashes the EIP-712 struct, MODULE_CHANGE hashes the self call', () => {
    const order = { account: A, id: 1, payee: T, amount: 1_200_000_000n, period: 2_592_000, firstDue: 1_800_000_000n, rail: Rail.ALIPAY_PLUS, merchantRef: merchantRef('M') };
    const so = ownerActionPayload({ kind: OwnerActionKind.ADD_STANDING_ORDER, account: A, order });
    expect(so.payloadHash).toBe(structHash('StandingOrder', order));
    const data = '0x9517e29f' as Hex;
    const mc = ownerActionPayload({ kind: OwnerActionKind.MODULE_CHANGE, account: A, moduleCallData: data });
    expect(mc.payload).toBe(data);
    expect(mc.payloadHash).toBe(callHash({ account: A, target: A, value: 0n, data }));
  });

  it('ADD_STANDING_ORDER refuses an order for another account', () => {
    const order = { account: T, id: 1, payee: T, amount: 1n, period: 1, firstDue: 1n, rail: Rail.USDC_DIRECT, merchantRef: `0x${'0'.repeat(64)}` as Hex };
    expect(() => ownerActionPayload({ kind: OwnerActionKind.ADD_STANDING_ORDER, account: A, order })).toThrow(/account/);
  });
});
