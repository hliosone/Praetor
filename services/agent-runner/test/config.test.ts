import { describe, it, expect } from 'vitest';
import { opencodeConfig, AGENTS_MD, wakeMessage } from '../src/opencode-config.js';

const base = { account: '0x00000000000000000000000000000000000c0ffe', model: 'opencode/deepseek-v4.1-flash-free', mcpUrl: 'http://mcp:3080/mcp' };

describe('opencode.json per account', () => {
  it('locks the built-in tools behind permission prompts (rejected by the runner), Praetor tools allowed (Q34)', () => {
    const c = opencodeConfig(base);
    expect(c.permission).toEqual({ '*': 'ask', webfetch: 'deny', websearch: 'deny', glob: 'deny', grep: 'deny', lsp: 'deny', question: 'deny', 'praetor_*': 'allow' });
    expect(c.model).toBe('opencode/deepseek-v4.1-flash-free');
  });
  it('takes out of the model\'s tool list the tools whose permission request can carry an undefined field, or that ask nothing (RT-84, RT-05)', () => {
    // OpenCode 1.19 cannot list pending permissions once one has an undefined metadata field (webfetch's timeout,
    // glob's and grep's path), so the runner rejects nothing and the turn hangs. OpenCode drops a tool whose last
    // matching rule is a "*" deny; the rule must come after the "*" ask to win. Denying every built-in tool is not
    // possible: the free tier refuses requests without them (V6).
    const keys = Object.keys(opencodeConfig(base).permission);
    for (const t of ['webfetch', 'websearch', 'glob', 'grep', 'lsp', 'question']) expect(keys.indexOf(t), t).toBeGreaterThan(keys.indexOf('*'));
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
  // The prompt wraps its lines: phrases are matched with the line breaks folded.
  const md = AGENTS_MD.replace(/\s+/g, ' ');
  it('AGENTS.md says money moves only through the tools, refusals are final, and to answer in the user language', () => {
    expect(AGENTS_MD).toMatch(/only through the praetor tools/i);
    expect(AGENTS_MD).toMatch(/refusal is final/i);
    expect(AGENTS_MD).toMatch(/中文/);
  });
  it('AGENTS.md: a payment the user asked for that needs the owner (T2) is submitted with pay so the owner gets the request; only a T0 refusal is final (#4)', () => {
    expect(md).toMatch(/needs the owner's approval \(T2: a new payee, above the amount you may pay alone/);
    expect(md).toMatch(/call pay \(or rebalance\) once: that is what sends the owner the approval request/);
    expect(md).toMatch(/A dry run that says the owner must approve is not a refusal/);
    expect(md).toMatch(/Only a T0 refusal is final: nobody can approve it/);
    // The limits stay: no retry, no split, no way around a limit, for T0 and T2 alike.
    expect(md).toMatch(/Never retry an action with other amounts, payees or a different split, and never try to get around a limit, whether it was refused or waits for the owner/);
  });
  it('AGENTS.md has no em dash', () => {
    expect(AGENTS_MD).not.toContain(String.fromCharCode(0x2014));
  });
  it('a band wake names the weights, the bands and today\'s rebalances', () => {
    const m = wakeMessage('BAND', { weights: { tXAU: 3610 }, bands: { tXAU: { minBps: 2000, maxBps: 3500 } }, rebalancesToday: 0, maxRebalancesPerDay: 1 });
    expect(m).toMatch(/tXAU 36.1%/);
    expect(m).toMatch(/20% to 35%/);
    expect(m).toMatch(/0 of 1/);
  });
});
