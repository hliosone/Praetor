// Placeholders and call encoding of the case format: cases name `$usdc`, `$attacker`, `usdc:2500`, `$now+600` instead
// of addresses and raw amounts, and calls by signature, so a held-out file stays readable and environment-free.
import { describe, it, expect } from 'vitest';
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, encodePacked, parseAbi, sliceHex, type Address } from 'viem';
import { resolveValue, encodeCall, encodeCallData, MODES } from '../lib/resolve.js';

const usdc = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address;
const attacker = '0x000000000000000000000000000000000000bEEF' as Address;
const account = '0x1111111111111111111111111111111111111111' as Address;
const vars = { usdc, attacker, account, nonce: '7' };
const erc20 = parseAbi(['function transfer(address,uint256)', 'function approve(address,uint256)']);
const accountAbi = parseAbi(['function execute(bytes32 mode, bytes executionCalldata)', 'function installModule(uint256,address,bytes)']);
const EXECUTIONS = [{ type: 'tuple[]', components: [{ name: 'target', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'callData', type: 'bytes' }] }] as const;

describe('resolveValue', () => {
  it('substitutes $names, usdc amounts and $now / $var arithmetic, deeply', () => {
    expect(resolveValue({ a: ['$attacker', 'usdc:2500', 'usdc:12.5'], b: '$now+600', c: '$nonce+1', d: '$now-1', e: 'plain' }, vars, 1000n)).toEqual({
      a: [attacker, '2500000000', '12500000'], b: '1600', c: '8', d: '999', e: 'plain',
    });
  });

  it('refuses an unknown placeholder rather than sending it as text', () => {
    expect(() => resolveValue('$nobody', vars, 0n)).toThrow(/\$nobody/);
    expect(() => resolveValue('usdc:abc', vars, 0n)).toThrow(/usdc:abc/);
  });

  it('keeps 2^256-1 style constants: $max256 and $max64', () => {
    expect(resolveValue(['$max256', '$max64'], vars, 0n)).toEqual([(2n ** 256n - 1n).toString(), (2n ** 64n - 1n).toString()]);
  });
});

describe('encodeCall', () => {
  it('encodes a call by signature with typed arguments', () => {
    const c = encodeCall({ to: '$usdc', fn: 'transfer(address,uint256)', args: ['$attacker', 'usdc:2500'] }, vars, 0n);
    expect(c).toEqual({ to: usdc, value: 0n, data: encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [attacker, 2_500_000_000n] }) });
  });

  it('passes raw data and a value through', () => {
    expect(encodeCall({ to: '$attacker', value: '1', data: '0x' }, vars, 0n)).toEqual({ to: attacker, value: 1n, data: '0x' });
  });

  it('encodes bytes, bool and bytes32 arguments', () => {
    const c = encodeCall({ to: '$account', fn: 'f(bytes,bool,bytes32)', args: ['0xdead', true, `0x${'ab'.repeat(32)}`] }, vars, 0n);
    expect(decodeAbiParameters([{ type: 'bytes' }, { type: 'bool' }, { type: 'bytes32' }], sliceHex(c.data, 4))).toEqual(['0xdead', true, `0x${'ab'.repeat(32)}`]);
  });
});

describe('encodeCallData', () => {
  const call = { to: '$usdc', fn: 'transfer(address,uint256)', args: ['$attacker', '5'] };
  const data = encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [attacker, 5n] });

  it('one call: ERC-7579 single mode, packed target | value | data', () => {
    const cd = encodeCallData({ execute: { calls: [call] } }, vars, 0n);
    expect(cd).toBe(encodeFunctionData({ abi: accountAbi, functionName: 'execute', args: [MODES.single, encodePacked(['address', 'uint256', 'bytes'], [usdc, 0n, data])] }));
  });

  it('several calls: batch mode, ABI-encoded executions; trailing bytes make it non-canonical', () => {
    const cd = encodeCallData({ execute: { calls: [call, call] } }, vars, 0n);
    const exec = encodeAbiParameters(EXECUTIONS, [[{ target: usdc, value: 0n, callData: data }, { target: usdc, value: 0n, callData: data }]]);
    expect(cd).toBe(encodeFunctionData({ abi: accountAbi, functionName: 'execute', args: [MODES.batch, exec] }));
    const odd = encodeCallData({ execute: { mode: 'batch', calls: [call], trailing: `0x${'00'.repeat(32)}` } }, vars, 0n);
    const [, oddExec] = decodeFunctionData({ abi: accountAbi, data: odd }).args as readonly [string, `0x${string}`];
    expect(oddExec.endsWith('00'.repeat(32))).toBe(true);
    expect(decodeAbiParameters(EXECUTIONS, oddExec)[0]).toHaveLength(1);
  });

  it('delegatecall and try modes carry the ERC-7579 call type and exec type bytes', () => {
    expect(MODES.delegatecall.slice(0, 4)).toBe('0xff');
    expect(MODES['try-single'].slice(0, 6)).toBe('0x0001');
    expect(MODES['try-batch'].slice(0, 6)).toBe('0x0101');
    const cd = encodeCallData({ execute: { mode: 'delegatecall', calls: [call] } }, vars, 0n);
    const [mode, exec] = decodeFunctionData({ abi: accountAbi, data: cd }).args as readonly [string, `0x${string}`];
    expect(mode).toBe(MODES.delegatecall);
    expect(exec).toBe(encodePacked(['address', 'bytes'], [usdc, data]));
  });

  it('an account function by signature, and raw call data', () => {
    const cd = encodeCallData({ fn: 'installModule(uint256,address,bytes)', args: ['2', '$attacker', '0x'] }, vars, 0n);
    expect(decodeFunctionData({ abi: accountAbi, data: cd }).args).toEqual([2n, attacker, '0x']);
    expect(encodeCallData({ raw: '0xabcdef' }, vars, 0n)).toBe('0xabcdef');
  });
});
