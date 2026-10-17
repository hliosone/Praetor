import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';
import { BPS, MAX_AMOUNT, MAX_BANDS, MAX_MERCHANTS, MAX_PAYEES } from './constants.js';

export type Band = { token: Address; minBps: number; targetBps: number; maxBps: number };
export type Policy = {
  autoCap: bigint; hardCap: bigint; dailyBudget: bigint; monthlyBudget: bigint; dailyCount: number;
  bufferUsdc: bigint;
  payees: Address[];
  merchants: Hex[];
  bands: Band[];
  maxRebalancesPerDay: number; maxTradeUsd: bigint; maxSlippageBps: number;
  validUntil: bigint;
  soterEnabled: boolean;
};

export const POLICY_ABI = [{
  type: 'tuple',
  components: [
    { name: 'autoCap', type: 'uint256' }, { name: 'hardCap', type: 'uint256' }, { name: 'dailyBudget', type: 'uint256' },
    { name: 'monthlyBudget', type: 'uint256' }, { name: 'dailyCount', type: 'uint16' }, { name: 'bufferUsdc', type: 'uint256' },
    { name: 'payees', type: 'address[]' }, { name: 'merchants', type: 'bytes32[]' },
    { name: 'bands', type: 'tuple[]', components: [
      { name: 'token', type: 'address' }, { name: 'minBps', type: 'uint16' }, { name: 'targetBps', type: 'uint16' }, { name: 'maxBps', type: 'uint16' },
    ] },
    { name: 'maxRebalancesPerDay', type: 'uint8' }, { name: 'maxTradeUsd', type: 'uint256' }, { name: 'maxSlippageBps', type: 'uint16' },
    { name: 'validUntil', type: 'uint64' }, { name: 'soterEnabled', type: 'bool' },
  ],
}] as const;

export const encodePolicy = (p: Policy): Hex => encodeAbiParameters(POLICY_ABI, [p]);
export const policyHash = (p: Policy): Hex => keccak256(encodePolicy(p));

// Rule codes in check order; PraetorTypes.validatePolicy returns the same index.
export const POLICY_RULES = [
  'OK', 'AUTO_CAP_GT_HARD_CAP', 'DAILY_GT_MONTHLY', 'AMOUNT_TOO_LARGE', 'TOO_MANY_PAYEES', 'TOO_MANY_MERCHANTS',
  'BAND_COUNT', 'USDC_NOT_FIRST', 'BAND_ORDER', 'TARGET_SUM', 'ZERO_ADDRESS', 'DUPLICATE_PAYEE',
  'DUPLICATE_MERCHANT', 'DUPLICATE_TOKEN', 'BPS_RANGE', 'EXPIRED',
] as const;
export type PolicyRule = (typeof POLICY_RULES)[number];

const ZERO = '0x0000000000000000000000000000000000000000';
const hasDup = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase())).size !== xs.length;

export function validatePolicy(p: Policy, now: bigint, usdc: Address): PolicyRule {
  if (p.autoCap > p.hardCap) return 'AUTO_CAP_GT_HARD_CAP';
  if (p.dailyBudget > p.monthlyBudget) return 'DAILY_GT_MONTHLY';
  if ([p.autoCap, p.hardCap, p.dailyBudget, p.monthlyBudget, p.bufferUsdc, p.maxTradeUsd].some((a) => a > MAX_AMOUNT)) return 'AMOUNT_TOO_LARGE';
  if (p.payees.length > MAX_PAYEES) return 'TOO_MANY_PAYEES';
  if (p.merchants.length > MAX_MERCHANTS) return 'TOO_MANY_MERCHANTS';
  if (p.bands.length === 0 || p.bands.length > MAX_BANDS) return 'BAND_COUNT';
  if (p.bands[0]!.token.toLowerCase() !== usdc.toLowerCase()) return 'USDC_NOT_FIRST';
  if (p.bands.some((b) => b.minBps > b.targetBps || b.targetBps > b.maxBps || b.maxBps > BPS)) return 'BAND_ORDER';
  if (p.bands.reduce((s, b) => s + b.targetBps, 0) !== BPS) return 'TARGET_SUM';
  if (p.payees.some((a) => a.toLowerCase() === ZERO) || p.bands.some((b) => b.token.toLowerCase() === ZERO)) return 'ZERO_ADDRESS';
  if (hasDup(p.payees)) return 'DUPLICATE_PAYEE';
  if (hasDup(p.merchants)) return 'DUPLICATE_MERCHANT';
  if (hasDup(p.bands.map((b) => b.token))) return 'DUPLICATE_TOKEN';
  if (p.maxSlippageBps > BPS) return 'BPS_RANGE';
  if (p.validUntil <= now) return 'EXPIRED';
  return 'OK';
}
