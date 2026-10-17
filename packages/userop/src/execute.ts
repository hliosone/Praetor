import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, encodePacked, parseAbi, sliceHex, hexToBigInt, type Address, type Hex } from 'viem';
import { MODE_BATCH, MODE_SINGLE } from './constants.js';

export type Call = { to: Address; value: bigint; data: Hex };

export const accountAbi = parseAbi([
  'function execute(bytes32 mode, bytes executionCalldata)',
  'function installModule(uint256 moduleTypeId, address module, bytes initData)',
  'function uninstallModule(uint256 moduleTypeId, address module, bytes deInitData)',
  'function setRegistry(address registry, address[] attesters, uint8 threshold)',
  'function isModuleInstalled(uint256 moduleTypeId, address module, bytes additionalContext) view returns (bool)',
]);

const EXECUTIONS = [{ type: 'tuple[]', components: [{ name: 'target', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'callData', type: 'bytes' }] }] as const;

/** ERC-7579 execute: single mode (packed target | value | data) for one call, batch mode otherwise. */
export function encodeExecute(calls: Call[]): Hex {
  if (calls.length === 1) {
    const c = calls[0]!;
    return encodeFunctionData({ abi: accountAbi, functionName: 'execute', args: [MODE_SINGLE, encodePacked(['address', 'uint256', 'bytes'], [c.to, c.value, c.data])] });
  }
  const exec = encodeAbiParameters(EXECUTIONS, [calls.map((c) => ({ target: c.to, value: c.value, callData: c.data }))]);
  return encodeFunctionData({ abi: accountAbi, functionName: 'execute', args: [MODE_BATCH, exec] });
}

/** The calls inside an execute callData; refuses every other selector and mode (what the bundler simulates). */
export function decodeExecute(callData: Hex): { mode: Hex; calls: Call[] } {
  const d = decodeFunctionData({ abi: accountAbi, data: callData });
  if (d.functionName !== 'execute') throw new Error(`not an execute call: ${d.functionName}`);
  const [mode, exec] = d.args as readonly [Hex, Hex];
  if (mode === MODE_SINGLE) {
    return { mode, calls: [{ to: sliceHex(exec, 0, 20), value: hexToBigInt(sliceHex(exec, 20, 52)), data: exec.length > 106 ? sliceHex(exec, 52) : '0x' }] };
  }
  if (mode === MODE_BATCH) {
    const [xs] = decodeAbiParameters(EXECUTIONS, exec);
    return { mode, calls: xs.map((x) => ({ to: x.target, value: x.value, data: x.callData })) };
  }
  throw new Error(`unsupported execution mode ${mode}`);
}
