// The closed vocabularies a case may name (README "Case format"): account fixtures and custom executors. Kept apart
// from fixtures.ts and executors.ts so the case set can be checked without a running stack.

/** Account fixtures (fixtures.ts). `fresh` is a new onboarded account for that case alone. */
export const FIXTURES = [
  'main', 'inj-a', 'inj-b', 'inj-label', 'limits', 'split', 'budget', 'count', 'swaps', 'rebalance2', 'shape', 'owner', 'frozen', 'bare',
  'approvals', 'soter', 'payouts', 'cn', 'standing', 'web', 'fresh',
] as const;
export type FixtureName = (typeof FIXTURES)[number];

/** Named executors (executors.ts) for attacks that take more than one request. */
export const CUSTOM_EXECUTORS = [
  'set-labels', 'register-approval', 'tier2', 'soter', 'replay-status', 'standing-order', 'stale-sim', 'erc1271', 'mcp-agent-bearer',
  'mcp-cross-account', 'oauth-redirect', 'oauth-token', 'pii-scan', 'xss-label', 'ws-origin', 'global',
] as const;
export type CustomExecutor = (typeof CUSTOM_EXECUTORS)[number];

/** Placeholders a case may use (`$name`, `$name+N`): fixtures.ts fills them per account and per case. */
export const VARS = [
  'account', 'agent', 'usdc', 'txau', 'txag', 'desk', 'rail', 'partner', 'hook', 'refusalLog', 'standingOrders', 'entryPoint',
  'agentValidator', 'passkeyValidator', 'noOwner', 'landlord', 'utilities', 'cafe', 'merchantKowloon', 'attacker', 'attacker2', 'paymentRef',
  'sanctioned', 'sanctionNonce', 'unlistedToken', 'delistedToken', 'suspendedPartner', 'xau100', 'statusNonce', 'noOwnerSig',
  'transferToAttacker', 'packedTransferToAttacker', 'zeroAddress', 'apiUrl', 'mcpUrl', 'webUrl', 'now', 'max256', 'max64', 'zero32',
] as const;
