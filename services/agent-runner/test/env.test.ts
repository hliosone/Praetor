import { describe, it, expect } from 'vitest';
import { envSchema } from '../src/env.js';

const required = { INTERNAL_TOKEN_AGENT: 'a'.repeat(32), INTERNAL_TOKEN_MCP: 'm'.repeat(32), OPENCODE_SERVER_PASSWORD: 'p'.repeat(16) };

describe('agent-runner environment', () => {
  it('reads an empty FAKE_LLM_URL as no fake model: prod sets it empty to override the example file, and the server crash-looped on "Invalid url"', () => {
    expect(envSchema.parse({ ...required, FAKE_LLM_URL: '' }).FAKE_LLM_URL).toBeUndefined();
    expect(envSchema.parse({ ...required, FAKE_LLM_URL: 'http://fake-llm:3090' }).FAKE_LLM_URL).toBe('http://fake-llm:3090');
    expect(() => envSchema.parse({ ...required, FAKE_LLM_URL: 'not a url' })).toThrow();
  });
});
