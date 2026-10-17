import { describe, it, expect } from 'vitest';
import { concat, encodeAbiParameters, encodePacked, getContractAddress, keccak256, pad, toHex, type Address, type Hex } from 'viem';
import { getUserOperationHash } from 'viem/account-abstraction';
import { privateKeyToAccount } from 'viem/accounts';
import {
  nonceKey, launchpadInitData, initHash, predictAccountAddress, initExecs, setupSafeCallData, initCode, encodeExecute,
  decodeExecute, userOpHash, packUserOp, paymasterHash, withPaymasterSignature, toJson, fromJson, agentSignature,
  LAUNCHPAD, FACTORY, ADAPTER, SINGLETON, REGISTRY_ATTESTER, ENTRY_POINT, MODE_SINGLE, MODE_BATCH, type UserOp,
} from '../src/index.js';

const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;

describe('nonce key (spec 00)', () => {
  it('puts the validator in the top 20 bytes of the 24-byte key', () => {
    expect(nonceKey(A(0xabc))).toBe(0xabcn << 32n);
  });
});

describe('launchpad init (spec 00, Q15, Q16)', () => {
  it('hashes every InitData field except callData, like the deployed launchpad', () => {
    // Known answer read from the launchpad on Base Sepolia (Phase B, hash(InitData)).
    const d = {
      singleton: SINGLETON, owners: [A(0x1111111111)] as Address[], threshold: 1n, setupTo: LAUNCHPAD, setupData: '0x1234' as Hex,
      safe7579: ADAPTER, validators: [{ module: A(0x2222222222), initData: '0xabcd' as Hex }], callData: '0xdeadbeef' as Hex,
    };
    const ones = { ...d, owners: ['0x1111111111111111111111111111111111111111' as Address], validators: [{ module: '0x2222222222222222222222222222222222222222' as Address, initData: '0xabcd' as Hex }] };
    expect(initHash(ones)).toBe('0x98a4cb3dd2162820e70ce6a87ad093b6d3d847b0910a6105eb1791e2395f60be');
    expect(initHash({ ...ones, callData: '0x' })).toBe(initHash(ones));
  });

  it('builds the init data with NoOwner, both validators and the registry attester', () => {
    const d = launchpadInitData({ noOwner: A(1), passkeyValidator: A(2), agentKeyValidator: A(3), credIdHash: `0x${'aa'.repeat(32)}`, x: 5n, y: 6n }, '0x');
    expect(d.owners).toEqual([A(1)]);
    expect(d.threshold).toBe(1n);
    expect(d.validators).toEqual([
      { module: A(2), initData: encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }], [`0x${'aa'.repeat(32)}`, 5n, 6n]) },
      { module: A(3), initData: '0x' },
    ]);
    expect(d.setupData.toLowerCase()).toContain(REGISTRY_ATTESTER.slice(2).toLowerCase());
  });

  it('orders the init batch registry, executor, hook (Q15) and wraps it in setupSafe (0xd9ed0e8f)', () => {
    const xs = initExecs(A(9), { standingOrders: A(7), mandateHook: A(8) });
    expect(xs.map((x) => x.data.slice(0, 10))).toEqual(['0xeab77e17', '0x9517e29f', '0x9517e29f']);
    expect(xs[1]!.data.toLowerCase()).toContain(A(7).slice(2).toLowerCase());
    expect(xs[2]!.data.toLowerCase()).toContain(A(8).slice(2).toLowerCase());
    const d = launchpadInitData({ noOwner: A(1), passkeyValidator: A(2), agentKeyValidator: A(3), credIdHash: `0x${'aa'.repeat(32)}`, x: 5n, y: 6n }, encodeExecute(xs));
    expect(setupSafeCallData(d).slice(0, 10)).toBe('0xd9ed0e8f');
  });

  it('predicts the CREATE2 address of the Safe proxy from the factory creation code', () => {
    const code = '0x6080604052' as Hex;
    const initializer = '0x1234' as Hex;
    const salt = keccak256(encodePacked(['bytes32', 'uint256'], [keccak256(initializer), 3n]));
    const expected = getContractAddress({ opcode: 'CREATE2', from: FACTORY, salt, bytecode: concat([code, pad(LAUNCHPAD, { size: 32 })]) });
    expect(predictAccountAddress(initializer, 3n, code)).toBe(expected);
    expect(initCode(initializer, 3n).slice(0, 42).toLowerCase()).toBe(FACTORY.toLowerCase());
  });
});

describe('execute encoding (ERC-7579)', () => {
  it('uses single mode for one call (packed) and batch mode otherwise, and decodes back', () => {
    const one = encodeExecute([{ to: A(5), value: 0n, data: '0xa9059cbb' }]);
    expect(decodeExecute(one)).toEqual({ mode: MODE_SINGLE, calls: [{ to: A(5), value: 0n, data: '0xa9059cbb' }] });
    const two = encodeExecute([{ to: A(5), value: 0n, data: '0x01' }, { to: A(6), value: 0n, data: '0x02' }]);
    const d = decodeExecute(two);
    expect(d.mode).toBe(MODE_BATCH);
    expect(d.calls).toHaveLength(2);
  });

  it('refuses other selectors and modes', () => {
    expect(() => decodeExecute('0x12345678')).toThrow();
    const delegate = ('0xe9ae5c53' + 'ff'.padEnd(64, '0') + encodeAbiParameters([{ type: 'bytes' }], ['0x00']).slice(2)) as Hex;
    expect(() => decodeExecute(delegate)).toThrow(/mode/);
  });
});

describe('userOps (EntryPoint v0.7)', () => {
  const op: UserOp = {
    sender: A(0xa11c), nonce: nonceKey(A(2)) << 64n | 3n, callData: '0xe9ae5c53', callGasLimit: 300_000n, verificationGasLimit: 500_000n,
    preVerificationGas: 100_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, signature: '0x',
  };

  it('hashes like the EntryPoint (viem reference)', () => {
    expect(userOpHash(op, 84532)).toBe(getUserOperationHash({ userOperation: op, entryPointAddress: ENTRY_POINT, entryPointVersion: '0.7', chainId: 84532 }));
  });

  it('round-trips through JSON (hex strings on the wire)', () => {
    const j = toJson({ ...op, factory: A(1), factoryData: '0x01' });
    expect(typeof j.nonce).toBe('string');
    expect(fromJson(j)).toEqual({ ...op, factory: A(1), factoryData: '0x01' });
  });

  it('builds paymasterAndData = paymaster | gas limits | validUntil | validAfter | sig, with the D20 hash', async () => {
    const pm = A(0x9999);
    const key = keccak256(toHex('pm signer'));
    const signed = await withPaymasterSignature({ ...op }, { paymaster: pm, key, validUntil: 1_800_000_600, validAfter: 0, chainId: 84532 });
    const packed = packUserOp(signed);
    expect(packed.paymasterAndData.length).toBe(2 + 2 * (20 + 16 + 16 + 6 + 6 + 65));
    const prefix = packed.paymasterAndData.slice(0, 2 + 2 * 64) as Hex;
    const expected = keccak256(encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [packed.sender, packed.nonce, keccak256(packed.initCode), keccak256(packed.callData), packed.accountGasLimits, packed.preVerificationGas, packed.gasFees, keccak256(prefix), 84532n, pm]));
    expect(paymasterHash(signed, pm, 84532)).toBe(expected);
  });

  it('agent signature is an eth-signed message over the userOpHash', async () => {
    const key = keccak256(toHex('agent'));
    const h = userOpHash(op, 84532);
    const sig = await agentSignature(h, key);
    expect(sig).toBe(await privateKeyToAccount(key).signMessage({ message: { raw: h } }));
  });
});
