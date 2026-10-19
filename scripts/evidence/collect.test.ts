import { describe, it, expect } from 'vitest';
import type { Address } from 'viem';
import { Reason } from '@praetor/protocol';
import { baseDeploymentsFile, baseRows, noteLine } from './collect.js';

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

describe('Base deployment read', () => {
  it('is the environment\'s own file unless one is given (the M16 run\'s contracts after a redeploy)', () => {
    expect(baseDeploymentsFile('base-sepolia')).toBe('infra/deployments/base-sepolia.json');
    expect(baseDeploymentsFile('fork')).toBe('infra/deployments/fork.json');
    expect(baseDeploymentsFile('base-sepolia', 'infra/deployments/base-sepolia-m16.json')).toBe('infra/deployments/base-sepolia-m16.json');
  });
});

describe('flow notes', () => {
  it('keeps what the model said on one line and without em dashes (the repository refuses them)', () => {
    expect(noteLine('agent: waiting for the owner \u2014 request `abc`\n\nthen done')).toBe('agent: waiting for the owner, request `abc` then done');
  });
});
