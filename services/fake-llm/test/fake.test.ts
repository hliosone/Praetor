import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createFakeLlm } from '../src/app.js';

const tools = [{ type: 'function', function: { name: 'praetor_pay' } }, { type: 'function', function: { name: 'praetor_explain' } }, { type: 'function', function: { name: 'bash' } }];
const chat = (app: ReturnType<typeof createFakeLlm>, account: string, messages: unknown[], withTools = true) =>
  request(app).post(`/v1/acct/${account}/chat/completions`).send({ model: 'scripted', stream: false, messages, ...(withTools ? { tools } : {}) });

describe('fake LLM (automated tests only)', () => {
  it('replays the queued steps of an account in order, one per completion that offers tools', async () => {
    const app = createFakeLlm();
    await request(app).post('/admin/script/0xabc').send({ steps: [{ tool: 'praetor_explain', args: { type: 'pay' } }, { tool: 'praetor_pay', args: { payee: 'Cafe', amount: '12.50' } }, { text: 'Paid.' }] }).expect(204);
    const r1 = await chat(app, '0xabc', [{ role: 'user', content: 'pay the cafe' }]).expect(200);
    expect(r1.body.choices[0].message.tool_calls[0].function).toEqual({ name: 'praetor_explain', arguments: '{"type":"pay"}' });
    const title = await chat(app, '0xabc', [{ role: 'user', content: 'make a title' }], false).expect(200);
    expect(title.body.choices[0].message.content).toBe('Scripted');
    const r2 = await chat(app, '0xabc', [{ role: 'tool', content: 'ok' }]).expect(200);
    expect(r2.body.choices[0].message.tool_calls[0].function.name).toBe('praetor_pay');
    const r3 = await chat(app, '0xabc', [{ role: 'tool', content: 'Paid 12.50' }]).expect(200);
    expect(r3.body.choices[0].message.content).toBe('Paid.');
    const log = await request(app).get('/admin/log/0xabc').expect(200);
    expect(log.body.map((x: { lastRole: string }) => x.lastRole)).toEqual(['user', 'user', 'tool', 'tool']);
  });

  it('streams tool calls as OpenAI chunks', async () => {
    const app = createFakeLlm();
    await request(app).post('/admin/script/0xdef').send({ steps: [{ tool: 'praetor_pay', args: { amount: '1' } }] });
    const r = await request(app).post('/v1/acct/0xdef/chat/completions').send({ stream: true, messages: [{ role: 'user', content: 'x' }], tools }).expect(200);
    expect(r.text).toContain('"tool_calls"');
    expect(r.text.trim().endsWith('data: [DONE]')).toBe(true);
  });

  it('refuses to call a tool the request does not offer, and answers plainly once the script is done', async () => {
    const app = createFakeLlm();
    await request(app).post('/admin/script/0x1').send({ steps: [{ tool: 'praetor_unknown', args: {} }] });
    const r = await chat(app, '0x1', [{ role: 'user', content: 'x' }]).expect(200);
    expect(r.body.choices[0].message.content).toMatch(/not offered/);
    const done = await chat(app, '0x1', [{ role: 'user', content: 'x' }]).expect(200);
    expect(done.body.choices[0].message.content).toBe('Done.');
  });
});
