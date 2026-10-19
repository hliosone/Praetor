import { describe, it, expect } from 'vitest';
import { Status } from '@praetor/protocol';
import { wakeable, type AccountState } from '../src/active.js';

const NOW = 1_800_000_000n;
const live: AccountState = {
  now: NOW,
  policyValidUntil: NOW + 86_400n,
  kya: { kycLevel: 2, validUntil: NOW + 86_400n },
  agent: { key: '0x00000000000000000000000000000000000a6e47', validUntil: NOW + 86_400n, revoked: false },
  effectiveStatus: Status.ACTIVE,
  paused: false,
  recoveryPending: false,
};

describe('which accounts the scheduler may wake (spec 05: every active account)', () => {
  it('wakes an account with a live policy, a valid KYA and agent key, ACTIVE and not paused', () => {
    expect(wakeable(live)).toBe(true);
  });

  it('skips an account with no policy or an expired one', () => {
    expect(wakeable({ ...live, policyValidUntil: 0n })).toBe(false);
    expect(wakeable({ ...live, policyValidUntil: NOW - 1n })).toBe(false);
  });

  it('skips an account whose agent key is revoked, missing or expired, or whose KYA is invalid', () => {
    expect(wakeable({ ...live, agent: { ...live.agent, revoked: true } })).toBe(false);
    expect(wakeable({ ...live, agent: { ...live.agent, key: '0x0000000000000000000000000000000000000000' } })).toBe(false);
    expect(wakeable({ ...live, agent: { ...live.agent, validUntil: NOW - 1n } })).toBe(false);
    expect(wakeable({ ...live, kya: { kycLevel: 0, validUntil: NOW + 1n } })).toBe(false);
    expect(wakeable({ ...live, kya: { kycLevel: 2, validUntil: NOW - 1n } })).toBe(false);
  });

  it('skips a frozen or restricted account, an account the owner paused and one with a recovery pending', () => {
    expect(wakeable({ ...live, effectiveStatus: Status.FROZEN })).toBe(false);
    expect(wakeable({ ...live, effectiveStatus: Status.RESTRICTED })).toBe(false);
    expect(wakeable({ ...live, paused: true })).toBe(false);
    expect(wakeable({ ...live, recoveryPending: true })).toBe(false);
  });
});
