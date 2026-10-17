// Wire constants of spec 02. Solidity twin: sol/PraetorTypes.sol. Frozen once green (DECISIONS on any change).
import type { Address } from 'viem';

// The chain id in every digest, on Base and on FISCO alike (FISCO's own block.chainid is 20200).
export const BASE_CHAIN_ID = 84532;
export const DOMAIN_VERSION = '1';
export const DOMAIN_NAMES = { live: 'Praetor', local: 'Praetor-local', sandbox: 'Praetor-sandbox', test: 'Praetor-test' } as const;
export type DomainName = (typeof DOMAIN_NAMES)[keyof typeof DOMAIN_NAMES];
export const TEST_VERIFYING_CONTRACT = '0x00000000000000000000000000000000DeaDBeef' as Address;

export function praetorDomain(name: DomainName | string, verifyingContract: Address) {
  return { name, version: DOMAIN_VERSION, chainId: BASE_CHAIN_ID, verifyingContract } as const;
}

const enumOf = <const T extends readonly string[]>(names: T) =>
  Object.fromEntries(names.map((n, i) => [n, i])) as { readonly [K in T[number]]: number };

export const STATUSES = ['ACTIVE', 'RESTRICTED', 'FROZEN'] as const;
export const Status = enumOf(STATUSES);
export const RiskProfile = enumOf(['NONE', 'CONSERVATIVE', 'BALANCED', 'GROWTH'] as const);
export const AssetKind = enumOf(['TOKEN', 'DESK', 'PAYOUT_PARTNER'] as const);
export const AssetStatus = enumOf(['NONE', 'ACTIVE', 'SUSPENDED', 'DELISTED'] as const);
export const Rail = enumOf(['USDC_DIRECT', 'ALIPAY_PLUS', 'WECHAT_PAY'] as const);
export const TIERS = ['T0_NEVER', 'T1_AUTONOMOUS', 'T2_HUMAN', 'T3_OWNER', 'T4_CONSORTIUM'] as const;
export const Tier = enumOf(TIERS);
export const AuthKind = enumOf(['PASSKEY', 'SOTER'] as const);
export const PriceSource = enumOf(['PYTH', 'DEMO'] as const);

export const OWNER_ACTION_KINDS = [
  'SET_POLICY', 'ADD_STANDING_ORDER', 'CANCEL_STANDING_ORDER', 'LINK_WECHAT', 'UNLINK_WECHAT', 'SET_AGENT_KEY',
  'REVOKE_AGENT_KEY', 'PAUSE_AGENT', 'RESUME_AGENT', 'SET_OWNER_KEY', 'CANCEL_RECOVERY', 'MODULE_CHANGE', 'REMOVE_PAYEE',
] as const;
export type OwnerActionName = (typeof OWNER_ACTION_KINDS)[number];
// Literal values (not `number`) so owner action arguments narrow by kind.
export const OwnerActionKind = {
  SET_POLICY: 0, ADD_STANDING_ORDER: 1, CANCEL_STANDING_ORDER: 2, LINK_WECHAT: 3, UNLINK_WECHAT: 4, SET_AGENT_KEY: 5,
  REVOKE_AGENT_KEY: 6, PAUSE_AGENT: 7, RESUME_AGENT: 8, SET_OWNER_KEY: 9, CANCEL_RECOVERY: 10, MODULE_CHANGE: 11, REMOVE_PAYEE: 12,
} as const satisfies Record<OwnerActionName, number>;
// Actions that only make the account stricter: the owner alone may sign them (T3-). Everything else needs the bank.
export const OWNER_ALONE: ReadonlySet<OwnerActionName> = new Set([
  'CANCEL_STANDING_ORDER', 'UNLINK_WECHAT', 'REVOKE_AGENT_KEY', 'PAUSE_AGENT', 'RESUME_AGENT', 'CANCEL_RECOVERY', 'REMOVE_PAYEE',
]);

export const REASONS = [
  'OK', 'FROZEN', 'RESTRICTED', 'STALE_STATUS', 'SESSION_EXPIRED', 'TARGET_NOT_ALLOWED', 'SELECTOR_NOT_ALLOWED',
  'UNKNOWN_PAYEE', 'OVER_AUTO_CAP', 'OVER_HARD_CAP', 'BUDGET_EXCEEDED', 'COUNT_EXCEEDED', 'BAND_BREACH',
  'BUFFER_BREACH', 'TIER2_REQUIRED', 'TIER2_INVALID', 'ASSET_NOT_APPROVED', 'SANCTIONED', 'JURISDICTION_BLOCKED',
  'COUNTERPARTY_NOT_APPROVED', 'HIDDEN_CALL', 'REBALANCE_LIMIT', 'STALE_PRICE', 'SLIPPAGE', 'KYA_INVALID',
  'NO_POLICY', 'TIER3_REQUIRED', 'INVALID_AMOUNT',
] as const;
export type ReasonName = (typeof REASONS)[number];
export const Reason = enumOf(REASONS);

// Reasons a live human approval can lift. BUDGET_EXCEEDED and BAND_BREACH also have a T0 form (bank cap,
// bank maxWeight): the hook reports those with tier T0 and never lets an approval lift them (I8).
export const T2_REASONS: ReadonlySet<ReasonName> = new Set([
  'RESTRICTED', 'STALE_STATUS', 'UNKNOWN_PAYEE', 'OVER_AUTO_CAP', 'BUDGET_EXCEEDED', 'COUNT_EXCEEDED', 'BAND_BREACH',
  'BUFFER_BREACH', 'TIER2_REQUIRED', 'REBALANCE_LIMIT',
]);

// Amounts above this are refused before any arithmetic (INVALID_AMOUNT, I12).
export const MAX_AMOUNT = 2n ** 128n;
export const USDC_DECIMALS = 6;
export const TOKEN_DECIMALS = 18;
export const PRICE_DECIMALS = 8;
export const USDC_PRICE8 = 100_000_000n;
export const BPS = 10_000;
export const DAY_S = 86_400n;
export const MONTH_S = 30n * 86_400n;
export const MAX_APPROVAL_TTL_S = 3_600n;
export const MAX_HEARTBEAT_TTL_S = 86_400n;
export const MAX_PAYEES = 16;
export const MAX_MERCHANTS = 16;
export const MAX_BANDS = 4;
export const MAX_OWNER_KEYS = 4;
export const ZERO_HASH = `0x${'0'.repeat(64)}` as const;
