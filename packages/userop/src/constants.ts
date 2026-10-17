import type { Address, Hex } from 'viem';

// Deployed on Base Sepolia (spec 00; proven by Alex and V1). Ours are in infra/deployments/<env>.json.
export const ENTRY_POINT: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
export const ADAPTER: Address = '0x7579EE8307284F293B1927136486880611F20002';
export const LAUNCHPAD: Address = '0x7579011aB74c46090561ea277Ba79D510c6C00ff';
export const FACTORY: Address = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67'; // Safe 1.4.1 proxy factory
export const SINGLETON: Address = '0x41675C099F32341bf84BFc5382aF534df5C7461a'; // Safe 1.4.1 singleton
export const REGISTRY_ATTESTER: Address = '0x000000333034E9f539ce08819E12c1b8Cb29084d';
export const MODE_SINGLE: Hex = `0x${'00'.repeat(32)}`;
export const MODE_BATCH: Hex = `0x01${'00'.repeat(31)}`;
export const BASE_CHAIN_ID = 84532;
