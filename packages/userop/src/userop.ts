import { concat, encodeAbiParameters, keccak256, pad, slice, toHex, type Address, type Hex } from 'viem';
import { getUserOperationHash, toPackedUserOperation } from 'viem/account-abstraction';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import { BASE_CHAIN_ID, ENTRY_POINT } from './constants.js';

/** Unpacked v0.7 userOp (viem's shape). */
export type UserOp = {
  sender: Address; nonce: bigint; factory?: Address; factoryData?: Hex; callData: Hex;
  callGasLimit: bigint; verificationGasLimit: bigint; preVerificationGas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint;
  paymaster?: Address; paymasterVerificationGasLimit?: bigint; paymasterPostOpGasLimit?: bigint; paymasterData?: Hex;
  signature: Hex;
};

/** Safe7579 reads the validator from the top 20 bytes of the 24-byte nonce key. */
export const nonceKey = (validator: Address): bigint => BigInt(validator) << 32n;

export const packUserOp = (op: UserOp) => toPackedUserOperation(op);

export const userOpHash = (op: UserOp, chainId = BASE_CHAIN_ID): Hex =>
  getUserOperationHash({ userOperation: op, entryPointAddress: ENTRY_POINT, entryPointVersion: '0.7', chainId });

/** PraetorPaymaster.getHash (D20): everything of paymasterAndData before the signature, plus chain and paymaster. */
export function paymasterHash(op: UserOp, paymaster: Address, chainId = BASE_CHAIN_ID): Hex {
  const p = packUserOp({ ...op, paymaster, paymasterData: concat([slice(op.paymasterData ?? '0x' + '00'.repeat(12) as Hex, 0, 12)]) });
  const prefix = slice(p.paymasterAndData, 0, 64);
  return keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
    [p.sender, p.nonce, keccak256(p.initCode), keccak256(p.callData), p.accountGasLimits, p.preVerificationGas, p.gasFees, keccak256(prefix), BigInt(chainId), paymaster],
  ));
}

export type Sponsorship = { paymaster: Address; key: Hex; validUntil: number; validAfter: number; chainId?: number; verificationGasLimit?: bigint; postOpGasLimit?: bigint };

/** Sets the paymaster fields and signs the sponsorship (eth-signed message, D20). Sign before the account signs. */
export async function withPaymasterSignature(op: UserOp, s: Sponsorship): Promise<UserOp> {
  const validity = concat([pad(toHex(s.validUntil), { size: 6 }), pad(toHex(s.validAfter), { size: 6 })]);
  const draft: UserOp = {
    ...op, paymaster: s.paymaster, paymasterVerificationGasLimit: s.verificationGasLimit ?? 200_000n,
    paymasterPostOpGasLimit: s.postOpGasLimit ?? 50_000n, paymasterData: validity,
  };
  const h = paymasterHash(draft, s.paymaster, s.chainId);
  const sig = await privateKeyToAccount(s.key).signMessage({ message: { raw: h } });
  return { ...draft, paymasterData: concat([validity, sig]) };
}

/** The agent key signs the userOpHash as an eth-signed message (AgentKeyValidator); done in the TEE in production. */
export const agentSignature = (h: Hex, key: Hex): Promise<Hex> => privateKeyToAccount(key).signMessage({ message: { raw: h } });

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/).transform((s) => s as Hex);
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s as Address);
const big = z.string().regex(/^(0x[0-9a-fA-F]+|[0-9]+)$/).transform((s) => BigInt(s));

export const userOpJsonSchema = z.object({
  sender: addr, nonce: big, factory: addr.optional(), factoryData: hex.optional(), callData: hex,
  callGasLimit: big, verificationGasLimit: big, preVerificationGas: big, maxFeePerGas: big, maxPriorityFeePerGas: big,
  paymaster: addr.optional(), paymasterVerificationGasLimit: big.optional(), paymasterPostOpGasLimit: big.optional(),
  paymasterData: hex.optional(), signature: hex,
});
export type UserOpJson = z.input<typeof userOpJsonSchema>;

export function toJson(op: UserOp): UserOpJson {
  return Object.fromEntries(Object.entries(op).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === 'bigint' ? toHex(v) : v])) as UserOpJson;
}

export const fromJson = (j: unknown): UserOp => userOpJsonSchema.parse(j) as UserOp;
