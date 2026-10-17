import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Address } from 'viem';
import { submitter } from '../src/ports.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as Address;
const ROTATED = '0x00000000000000000000000000000000000a9e02' as Address;

afterEach(() => { vi.unstubAllGlobals(); });

describe('submission through agent-signer', () => {
  it('asks the signer for the key that is the account\'s agent key on-chain (F10: after a rotation)', async () => {
    const bodies: Record<string, any> = {};
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      const path = new URL(url).pathname;
      bodies[path] = JSON.parse(init.body);
      const out = path.endsWith('/userop/prepare') ? { userOp: { sender: ACCOUNT, nonce: '0' } }
        : path.endsWith('/sign-userop') ? { signature: '0x01' }
        : { userOpHash: '0x02', txHash: '0x03', success: true, reasons: [] };
      return new Response(JSON.stringify(out), { status: 200 });
    });
    const submit = submitter({ bundlerUrl: 'http://bundler', bundlerToken: 't', signerUrl: 'http://signer', signerSecret: 's'.repeat(64), agentKeyOf: async () => ROTATED });
    const r = await submit(ACCOUNT, [{ to: '0x0000000000000000000000000000000000000bee', value: 0n, data: '0x' }]);
    expect(r.success).toBe(true);
    const sign = bodies[`/v1/agents/${ACCOUNT}/sign-userop`];
    expect(sign.agentKey).toBe(ROTATED);
    expect(sign.keyVersion).toBeUndefined();
  });
});
