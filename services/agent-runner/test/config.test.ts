import { describe, it, expect } from 'vitest';
import { opencodeConfig, AGENTS_MD, wakeMessage } from '../src/opencode-config.js';

const base = { account: '0x00000000000000000000000000000000000c0ffe', model: 'opencode/deepseek-v4.1-flash-free', mcpUrl: 'http://mcp:3080/mcp' };

describe('opencode.json per account', () => {
  it('locks the built-in tools behind permission prompts (rejected by the runner), Praetor tools allowed (Q34)', () => {
    const c = opencodeConfig(base);
    expect(c.permission['*']).toBe('ask');
    expect(c.permission['praetor_*']).toBe('allow');
    expect(c.model).toBe('opencode/deepseek-v4.1-flash-free');
  });
  it('takes out of the model\'s tool list the tools whose permission request can carry an undefined field, or that wait on a person (RT-84, RT-05, issue #5)', () => {
    // OpenCode 1.19 cannot list pending permissions once one has an undefined metadata field (webfetch's timeout,
    // glob's and grep's path), so the runner rejects nothing and the turn hangs. question waits for an answer the chat
    // never shows; plan_enter/plan_exit switch modes. OpenCode drops a tool whose last matching rule is a "*" deny;
    // the rule must come after the "*" ask to win. Denying every built-in tool is not possible: the free tier refuses
    // requests without them (V6).
    const c = opencodeConfig(base);
    expect(c.permission).toEqual({ '*': 'ask', webfetch: 'deny', websearch: 'deny', glob: 'deny', grep: 'deny', lsp: 'deny', question: 'deny', plan_enter: 'deny', plan_exit: 'deny', 'praetor_*': 'allow' });
    const keys = Object.keys(c.permission);
    for (const t of ['webfetch', 'websearch', 'glob', 'grep', 'lsp', 'question', 'plan_enter', 'plan_exit']) expect(keys.indexOf(t), t).toBeGreaterThan(keys.indexOf('*'));
    expect(JSON.parse(JSON.stringify(c)).permission.question).toBe('deny');
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
  it('AGENTS.md says money moves only through the tools, only T0 refusals are final, and to answer in the user language', () => {
    expect(AGENTS_MD).toMatch(/only through the praetor tools/i);
    expect(AGENTS_MD).toMatch(/Only a T0 refusal is final/);
    expect(AGENTS_MD).not.toMatch(/A refusal is final unless/);
    expect(AGENTS_MD).toMatch(/中文/);
  });
  it('AGENTS.md: a T2 dry run (e.g. UNKNOWN_PAYEE) means submit so the owner can approve, not stop (issue #4)', () => {
    expect(AGENTS_MD).toMatch(/T2[\s\S]*UNKNOWN_PAYEE[\s\S]*is not a refusal: submit the same action/);
    expect(AGENTS_MD).toMatch(/Never stop at such a dry run/);
  });
  it('AGENTS.md: report a freeze with who set it and who can loosen it, never a guessed reason (issue #6)', () => {
    expect(AGENTS_MD).toMatch(/frozen or restricted[\s\S]*who can loosen it/);
    expect(AGENTS_MD).toMatch(/Never\s+guess why/);
  });
  it('a band wake names the weights, the bands and today\'s rebalances', () => {
    const m = wakeMessage('BAND', { weights: { tXAU: 3610 }, bands: { tXAU: { minBps: 2000, maxBps: 3500 } }, rebalancesToday: 0, maxRebalancesPerDay: 1 });
    expect(m).toMatch(/tXAU 36.1%/);
    expect(m).toMatch(/20% to 35%/);
    expect(m).toMatch(/0 of 1/);
  });
});
