// The AgentMandate the owner signs names the agent key the page shows (F1 step 11, F10 rotation): a draft for another
// key (an api restarted mid-rotation falls back to key version 1, or an api that lies) gets no passkey signature.
import { describe, it, expect, vi } from 'vitest';

const assertDigest = vi.fn(async () => ({ id: 'c', response: {} }));
const api = vi.fn(async () => { throw new Error('the page should not reach the api'); });
vi.mock('./api.js', () => ({ api: (...a: unknown[]) => api(...(a as [])) }));
vi.mock('./passkey.js', () => ({ assertDigest: (...a: unknown[]) => assertDigest(...(a as [])), signAndSubmit: vi.fn() }));

const { installAgent } = await import('./agent.js');

const agent = { agentKey: '0x00000000000000000000000000000000000a9e02' as const, measurement: '0x01', simulator: true, agentWeId: 'did:weid:1:0x02', agentDidHash: `0x${'22'.repeat(32)}` as const };

describe('installAgent', () => {
  it('refuses to sign a mandate draft whose agent key is not the key on the page', async () => {
    const draft = { draftId: 'd1', challenge: `0x${'aa'.repeat(32)}` as const, claim: { agentKey: '0x00000000000000000000000000000000000a9e01' } };
    await expect(installAgent(agent, draft)).rejects.toThrow(/not signing/);
    expect(assertDigest).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });
});
