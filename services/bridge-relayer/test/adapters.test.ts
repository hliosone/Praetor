import { describe, it, expect } from 'vitest';
import type { PublicClient, WalletClient } from 'viem';
import { FiscoOutbox } from '../src/adapters.js';

const outboxAt = (timestamp: bigint) => new FiscoOutbox({ getBlock: async () => ({ timestamp }) } as unknown as PublicClient, {} as WalletClient, '0x00000000000000000000000000000000000000aa');

describe('FISCO outbox clock (the WeCross watchdog compares it with enqueuedAt, in seconds)', () => {
  it('reads FISCO time in seconds: the web3 RPC gives seconds, the EVM block.timestamp is milliseconds', async () => {
    expect(await outboxAt(1_792_275_506n).now()).toBe(1_792_275_506n);
    expect(await outboxAt(1_792_275_506_123n).now()).toBe(1_792_275_506n);
  });
});
