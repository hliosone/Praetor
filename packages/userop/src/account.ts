// Our Safe7579 + NoOwner account adapter (spec 00): launchpad init data, initHash, counterfactual address, init op.
// permissionless' ECDSA-owner path is not used.
import { concat, encodeAbiParameters, encodeFunctionData, encodePacked, getContractAddress, keccak256, pad, parseAbi, type Address, type Hex, type PublicClient } from 'viem';
import { ADAPTER, FACTORY, LAUNCHPAD, REGISTRY_ATTESTER, SINGLETON } from './constants.js';
import { accountAbi, encodeExecute, type Call } from './execute.js';

export type ModuleInit = { module: Address; initData: Hex };
export type LaunchpadInitData = {
  singleton: Address; owners: Address[]; threshold: bigint; setupTo: Address; setupData: Hex; safe7579: Address;
  validators: ModuleInit[]; callData: Hex;
};

export const launchpadAbi = parseAbi([
  'struct ModuleInit { address module; bytes initData; }',
  'struct InitData { address singleton; address[] owners; uint256 threshold; address setupTo; bytes setupData; address safe7579; ModuleInit[] validators; bytes callData; }',
  'function preValidationSetup(bytes32 initHash, address to, bytes preInit)',
  'function setupSafe(InitData initData)',
  'function initSafe7579(address safe7579, ModuleInit[] executors, ModuleInit[] fallbacks, ModuleInit[] hooks, address[] attesters, uint8 threshold)',
]);
const factoryAbi = parseAbi([
  'function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address)',
  'function proxyCreationCode() pure returns (bytes)',
]);

export type AccountModules = { noOwner: Address; passkeyValidator: Address; agentKeyValidator: Address; credIdHash: Hex; x: bigint; y: bigint };

/** NoOwner as the only Safe owner, threshold 1, validators [Passkey, AgentKey], one registry attester (GS000). */
export function launchpadInitData(m: AccountModules, callData: Hex): LaunchpadInitData {
  const none: ModuleInit[] = [];
  return {
    singleton: SINGLETON,
    owners: [m.noOwner],
    threshold: 1n,
    setupTo: LAUNCHPAD,
    setupData: encodeFunctionData({ abi: launchpadAbi, functionName: 'initSafe7579', args: [ADAPTER, none, none, none, [REGISTRY_ATTESTER], 1] }),
    safe7579: ADAPTER,
    validators: [
      { module: m.passkeyValidator, initData: encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }], [m.credIdHash, m.x, m.y]) },
      { module: m.agentKeyValidator, initData: '0x' },
    ],
    callData,
  };
}

/** The launchpad's hash(InitData): every field except callData (checked against the deployed launchpad). */
export function initHash(d: LaunchpadInitData): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'address[]' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes' }, { type: 'address' },
      { type: 'tuple[]', components: [{ name: 'module', type: 'address' }, { name: 'initData', type: 'bytes' }] }],
    [d.singleton, d.owners, d.threshold, d.setupTo, d.setupData, d.safe7579, d.validators],
  ));
}

export const initializer = (d: LaunchpadInitData): Hex =>
  encodeFunctionData({ abi: launchpadAbi, functionName: 'preValidationSetup', args: [initHash(d), '0x0000000000000000000000000000000000000000', '0x'] });

/** CREATE2 address of the Safe proxy, from the factory's own creation code (read on chain: Safe is LGPL). */
export function predictAccountAddress(init: Hex, saltNonce: bigint, proxyCreationCode: Hex): Address {
  const salt = keccak256(encodePacked(['bytes32', 'uint256'], [keccak256(init), saltNonce]));
  return getContractAddress({ opcode: 'CREATE2', from: FACTORY, salt, bytecode: concat([proxyCreationCode, pad(LAUNCHPAD, { size: 32 })]) });
}

let cachedCreationCode: Hex | undefined;
export async function proxyCreationCode(client: Pick<PublicClient, 'readContract'>): Promise<Hex> {
  cachedCreationCode ??= await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'proxyCreationCode' });
  return cachedCreationCode;
}

/** Init batch: setRegistry(0), install the executor, then the hook (Q15: hook last). */
export function initExecs(account: Address, d: { standingOrders: Address; mandateHook: Address }): Call[] {
  const enc = (fn: 'setRegistry' | 'installModule', args: readonly unknown[]) => encodeFunctionData({ abi: accountAbi, functionName: fn, args } as never);
  return [
    { to: account, value: 0n, data: enc('setRegistry', ['0x0000000000000000000000000000000000000000', [], 0]) },
    { to: account, value: 0n, data: enc('installModule', [2n, d.standingOrders, '0x']) },
    { to: account, value: 0n, data: enc('installModule', [4n, d.mandateHook, encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes4' }, { type: 'bytes' }], [0, '0x00000000', '0x'])]) },
  ];
}

export const setupSafeCallData = (d: LaunchpadInitData): Hex =>
  encodeFunctionData({ abi: launchpadAbi, functionName: 'setupSafe', args: [d] });

export const initCode = (init: Hex, saltNonce: bigint): Hex =>
  concat([FACTORY, encodeFunctionData({ abi: factoryAbi, functionName: 'createProxyWithNonce', args: [LAUNCHPAD, init, saltNonce] })]);

/** Everything the first op needs: the counterfactual address, factory data and setupSafe callData. */
export async function prepareAccount(
  client: Pick<PublicClient, 'readContract'>,
  m: AccountModules & { standingOrders: Address; mandateHook: Address },
  saltNonce: bigint,
): Promise<{ address: Address; factory: Address; factoryData: Hex; callData: Hex }> {
  const placeholder = launchpadInitData(m, '0x');
  const init = initializer(placeholder);
  const address = predictAccountAddress(init, saltNonce, await proxyCreationCode(client));
  const data = launchpadInitData(m, encodeExecute(initExecs(address, m)));
  const ic = initCode(init, saltNonce);
  return { address, factory: FACTORY, factoryData: `0x${ic.slice(42)}`, callData: setupSafeCallData(data) };
}
