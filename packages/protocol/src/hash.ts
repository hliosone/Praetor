import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from 'viem';
import { BASE_CHAIN_ID, MAX_AMOUNT } from './constants.js';

// Binds a human approval to one exact call. No nonce or expiry inside: those live in the approval (spec 02).
export function callHash(c: { account: Address; target: Address; value: bigint; data: Hex }): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }],
    [c.account, BigInt(BASE_CHAIN_ID), c.target, c.value, keccak256(c.data)],
  ));
}

const k = (s: string) => keccak256(toHex(s));

// Each raw identifier is hashed first, so neither the hash inputs nor the hash reveal the openid or the phone ids.
export function bindingHash(b: { mpAppId: string; openid: string; uid: string; cpuId: string }): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
    [k(b.mpAppId), k(b.openid), k(b.uid), k(b.cpuId)],
  ));
}

export const merchantRef = (merchantId: string): Hex => k(merchantId);

export const merchantKey = (partner: Address, ref: Hex): Hex =>
  keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [partner, ref]));

// USD value with 6 decimals; null when the amount is above 2^128 (the hook refuses INVALID_AMOUNT first).
export function valueUsd6(amount: bigint, price8: bigint, decimals: number): bigint | null {
  if (amount > MAX_AMOUNT || amount < 0n || price8 < 0n) return null;
  return (amount * price8) / 10n ** BigInt(decimals + 2);
}

// Multi-signature arrays must list distinct signers in ascending address order (the hook checks it).
export function sortSignatures(sigs: { signer: Address; sig: Hex }[]): Hex[] {
  const sorted = [...sigs].sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1));
  for (let i = 1; i < sorted.length; i++) {
    if (BigInt(sorted[i]!.signer) === BigInt(sorted[i - 1]!.signer)) throw new Error(`duplicate signer ${sorted[i]!.signer}`);
  }
  return sorted.map((s) => s.sig);
}

export const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

// WebAuthn.sol refuses s > n/2; iPhones return a high s about half the time, so normalise off-chain.
export const normalizeP256S = (s: bigint): bigint => (s > P256_N / 2n ? P256_N - s : s);
