import { describe, it, expect } from 'vitest';
import { encodeAbiParameters, keccak256, recoverAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { digest, praetorDomain, OwnerActionKind as K, type OwnerAction } from '@praetor/protocol';
import { RecoveryService } from '../src/recovery.js';

const BANK_KEY = keccak256('0x0b' as Hex);
const HOOK = '0x00000000000000000000000000000000000000aa' as Address;
const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as Address;
const key = { credIdHash: `0x${'ab'.repeat(32)}`, x: '0x01', y: '0x02' };

describe('bank-scheduled recovery (F10 step 6)', () => {
  it('signs SET_OWNER_KEY for the new passkey with the bank key and schedules it on Base; tells the user itself', async () => {
    const sent: { a: OwnerAction; payload: Hex; sigs: Hex[] }[] = [];
    const notices: string[] = [];
    const r = new RecoveryService({
      domain: { name: 'Praetor-test', hook: HOOK }, bankSignerKey: BANK_KEY, now: async () => 1_800_000_000n,
      schedule: async (a, payload, sigs) => { sent.push({ a, payload, sigs }); return `0x${'77'.repeat(32)}` as Hex; },
      notify: async (account, text) => { notices.push(`${account}: ${text}`); },
    });
    expect(await r.schedule(ACCOUNT, key)).toBe(`0x${'77'.repeat(32)}`);
    const { a, payload, sigs } = sent[0]!;
    expect(payload).toBe(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }], [key.credIdHash as Hex, 1n, 2n]));
    expect(a).toMatchObject({ account: ACCOUNT, action: K.SET_OWNER_KEY, payloadHash: keccak256(payload), expiresAt: 1_800_000_000n + 3600n });
    expect(await recoverAddress({ hash: digest(praetorDomain('Praetor-test', HOOK), 'OwnerAction', a), signature: sigs[0]! })).toBe(privateKeyToAccount(BANK_KEY).address);
    expect(notices).toEqual([`${ACCOUNT}: recovery scheduled: your keys will be replaced in 48 h unless you cancel it with one of your passkeys`]);
  });
});
