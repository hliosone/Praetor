import { describe, it, expect } from 'vitest';
import type { Address } from 'viem';
import { Reason } from '@praetor/protocol';
import { baseRows } from './collect.js';

const ME = '0x00000000000000000000000000000000000c0ffe' as Address;
const OTHER = '0x00000000000000000000000000000000000b0b0b' as Address;
const log = (tx: string, eventName: string, args: Record<string, unknown>) => ({ transactionHash: tx, decoded: { eventName, args } }) as never;

describe('evidence rows', () => {
  it('groups the flow accounts\' events by transaction, names refusal reasons, keeps anchors, drops other accounts', () => {
    const rows = baseRows([
      log('0x01', 'Refused', { account: ME, reason: Reason.SANCTIONED }),
      log('0x01', 'Decision', { account: ME, reason: Reason.SANCTIONED }),
      log('0x02', 'Decision', { account: OTHER, reason: Reason.OK }),
      log('0x03', 'Anchored', { seq: 1n }),
      log('0x04', 'OwnerActionApplied', { account: ME.toUpperCase().replace('0X', '0x') }),
    ], [ME]);
    expect(rows).toEqual([
      { tx: '0x01', events: ['Refused SANCTIONED', 'Decision SANCTIONED'] },
      { tx: '0x03', events: ['Anchored'] },
      { tx: '0x04', events: ['OwnerActionApplied'] },
    ]);
  });
});
