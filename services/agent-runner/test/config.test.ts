import { describe, it, expect } from 'vitest';
import { opencodeConfig, AGENTS_MD, wakeMessage } from '../src/opencode-config.js';

const base = { account: '0x00000000000000000000000000000000000c0ffe', model: 'opencode/deepseek-v4.1-flash-free', mcpUrl: 'http://mcp:3080/mcp' };

describe('opencode.json per account', () => {
  it('locks the built-in tools behind permission prompts (rejected by the runner), Praetor tools allowed (Q34)', () => {
    const c = opencodeConfig(base);
    expect(c.permission).toEqual({ '*': 'ask', webfetch: 'deny', websearch: 'deny', 'praetor_*': 'allow' });
    expect(c.model).toBe('opencode/deepseek-v4.1-flash-free');
  });
  it('takes the web tools out of the model\'s tool list: a rejected webfetch hangs its turn in OpenCode 1.19 (RT-84)', () => {
    // OpenCode drops a tool whose last matching rule is a "*" deny; the rule must come after the "*" ask to win.
    const keys = Object.keys(opencodeConfig(base).permission);
    expect(keys.indexOf('webfetch')).toBeGreaterThan(keys.indexOf('*'));
    expect(keys.indexOf('websearch')).toBeGreaterThan(keys.indexOf('*'));
  });
  it('passes the MCP bearer only through an env substitution: the file holds no token', () => {
    const c = opencodeConfig(base);
    expect(c.mcp.praetor).toEqual({ type: 'remote', url: 'http://mcp:3080/mcp', enabled: true, headers: { Authorization: 'Bearer {env:PRAETOR_MCP_TOKEN}' } });
    expect(JSON.stringify(c)).not.toMatch(/agt_/);
  });
  it('adds the scripted provider, on a per-account path, only when a fake LLM is configured', () => {
    expect(opencodeConfig(base).provider).toBeUndefined();
    const c = opencodeConfig({ ...base, model: 'fake/scripted', fakeLlmUrl: 'http://fake-llm:3090' });
    expect(c.provider.fake.options.baseURL).toBe('http://fake-llm:3090/v1/acct/0x00000000000000000000000000000000000c0ffe');
    expect(c.small_model).toBe('fake/scripted');
  });
});

describe('prompts', () => {
  it('AGENTS.md says money moves only through the tools, refusals are final, and to answer in the user language', () => {
    expect(AGENTS_MD).toMatch(/only through the praetor tools/i);
    expect(AGENTS_MD).toMatch(/refusal is final/i);
    expect(AGENTS_MD).toMatch(/中文/);
  });
  it('a band wake names the weights, the bands and today\'s rebalances', () => {
    const m = wakeMessage('BAND', { weights: { tXAU: 3610 }, bands: { tXAU: { minBps: 2000, maxBps: 3500 } }, rebalancesToday: 0, maxRebalancesPerDay: 1 });
    expect(m).toMatch(/tXAU 36.1%/);
    expect(m).toMatch(/20% to 35%/);
    expect(m).toMatch(/0 of 1/);
  });
});
