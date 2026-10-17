// Helpers for integration tests on the anvil fork: deployment, member signatures, owner actions, USDC.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { MandateHookAbi, loadDeployments, type Deployment } from '@praetor/chain';
import { digest, praetorDomain, sortSignatures, ownerActionPayload, passkeyAuth, type MessageOf, type PrimaryType, type SoftPasskey } from '@praetor/protocol';
import { ANVIL_URL, dotenv, repoRoot } from './stack.js';

const run = promisify(execFile);
export const pub = createPublicClient({ chain: baseSepolia, transport: http(ANVIL_URL) });

export async function deployFork(): Promise<Deployment> {
  await run('bash', ['scripts/deploy/contracts.sh', 'fork'], { cwd: repoRoot, timeout: 600_000 });
  return loadDeployments(`${repoRoot}infra/deployments/fork.json`);
}

export async function setBalance(address: Address, wei: bigint): Promise<void> {
  await pub.request({ method: 'anvil_setBalance' as never, params: [address, `0x${wei.toString(16)}`] as never });
}

export const env = dotenv();
export const localKey = (role: string): Hex => env[`LOCAL_${role}`] as Hex;
export const members = { bank: localKey('BANK_BASE_SIGNER_KEY'), regulator: localKey('REGULATOR_BASE_SIGNER_KEY'), operator: localKey('OPERATOR_BASE_SIGNER_KEY') };

/** Member signatures over a consortium message under the fork domain, sorted by signer. */
export async function sign<T extends PrimaryType>(d: Deployment, t: T, msg: MessageOf[T], keys: Hex[]): Promise<Hex[]> {
  const h = digest(praetorDomain(d.domainName, d.mandateHook), t, msg);
  const sigs = await Promise.all(keys.map(async (k) => ({ signer: privateKeyToAccount(k).address, sig: await privateKeyToAccount(k).sign({ hash: h }) })));
  return sortSignatures(sigs);
}

export async function nextNonce(d: Deployment, kind: number, key: Hex): Promise<bigint> {
  return BigInt(await pub.readContract({ address: d.mandateHook, abi: MandateHookAbi, functionName: 'nonces', args: [kind, key] })) + 1n;
}

export const pad32 = (a: string): Hex => `0x${a.slice(2).toLowerCase().padStart(64, '0')}`;

export const hookCall = (fn: string, args: readonly unknown[]): Hex => encodeFunctionData({ abi: MandateHookAbi, functionName: fn as never, args: args as never });

/** An owner action authorised by the passkey (and the bank when withBank), as calldata for the hook. */
export async function ownerActionCall(d: Deployment, account: Address, passkey: SoftPasskey, args: Parameters<typeof ownerActionPayload>[0], withBank: boolean, now: bigint): Promise<Hex> {
  const { payload, payloadHash } = ownerActionPayload(args);
  const a = { account, action: args.kind, payloadHash, nonce: BigInt(Math.floor(Math.random() * 2 ** 48)), expiresAt: now + 600n, fiscoRef: `0x${'00'.repeat(32)}` as Hex };
  const h = digest(praetorDomain(d.domainName, d.mandateHook), 'OwnerAction', a);
  const bankSigs = withBank ? [await privateKeyToAccount(members.bank).sign({ hash: h })] : [];
  return hookCall('applyOwnerAction', [a, payload, passkeyAuth(passkey.credIdHash, passkey.sign(h)), bankSigs]);
}

const fiat = parseAbi(['function masterMinter() view returns (address)', 'function configureMinter(address,uint256) returns (bool)', 'function mint(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);

/** Fork USDC through FiatToken's own minter path (impersonated master minter). */
export async function mintUsdc(d: Deployment, to: Address, amount: bigint): Promise<void> {
  const master = await pub.readContract({ address: d.usdc, abi: fiat, functionName: 'masterMinter' });
  const minter = '0x000000000000000000000000000000000000beef' as Address;
  for (const a of [master, minter]) {
    await pub.request({ method: 'anvil_impersonateAccount' as never, params: [a] as never });
    await setBalance(a, 10n ** 18n);
  }
  const w = createWalletClient({ chain: baseSepolia, transport: http(ANVIL_URL) });
  const h1 = await w.writeContract({ address: d.usdc, abi: fiat, functionName: 'configureMinter', args: [minter, amount], account: master, chain: baseSepolia });
  await pub.waitForTransactionReceipt({ hash: h1 });
  const h2 = await w.writeContract({ address: d.usdc, abi: fiat, functionName: 'mint', args: [to, amount], account: minter, chain: baseSepolia });
  await pub.waitForTransactionReceipt({ hash: h2 });
}

export const usdcBalance = (d: Deployment, a: Address) => pub.readContract({ address: d.usdc, abi: fiat, functionName: 'balanceOf', args: [a] });
