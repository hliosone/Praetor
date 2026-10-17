// The TEE behind the KeySource: dstack in a Phala CVM, the dstack simulator locally (same socket API, V5).
import { DstackClient } from '@phala/dstack-sdk';
import { bytesToHex } from 'viem';
import type { KeySource } from './app.js';

export function dstackKeys(endpoint: string): KeySource & { reachable(): Promise<boolean> } {
  const c = new DstackClient(endpoint);
  return {
    getKey: async (path) => {
      const k = await c.getKey(path, 'attester', 'secp256k1');
      if (k.key.length !== 32) throw new Error('unexpected key length');
      return bytesToHex(k.key);
    },
    quote: async (reportData) => ({ quote: (await c.getQuote(reportData)).quote }),
    info: async () => {
      const i = await c.info();
      return { appId: i.app_id, composeHash: i.compose_hash };
    },
    reachable: () => c.isReachable(),
  };
}
