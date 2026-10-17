// Scripted OpenAI-compatible model for the automated tests only (spec 05; the product uses the real model). Each
// account gets its own base URL (/v1/acct/<account>), so a test queues the exact steps of one agent: each completion
// that offers tools returns the next step (a tool call or a text). Completions without tools (OpenCode's title
// generation) never consume a step.
import express from 'express';
import { z } from 'zod';

type Step = { tool: string; args: Record<string, unknown> } | { text: string };

export function createFakeLlm() {
  const scripts = new Map<string, Step[]>();
  const log = new Map<string, { lastRole: string; tools: number; answered: string }[]>();
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.post('/admin/script/:account', (req, res) => {
    const steps = z.array(z.union([z.object({ tool: z.string(), args: z.record(z.unknown()) }), z.object({ text: z.string() })])).parse(req.body?.steps);
    scripts.set(req.params.account.toLowerCase(), steps);
    res.status(204).end();
  });
  app.get('/admin/log/:account', (req, res) => res.json(log.get(req.params.account.toLowerCase()) ?? []));

  app.get('/v1/acct/:account/models', (_req, res) => res.json({ data: [{ id: 'scripted', object: 'model' }] }));
  app.post('/v1/acct/:account/chat/completions', (req, res) => {
    const account = req.params.account.toLowerCase();
    const body = req.body as { model?: string; stream?: boolean; messages?: { role: string }[]; tools?: { function?: { name?: string } }[] };
    const offered = (body.tools ?? []).map((t) => t.function?.name).filter(Boolean) as string[];
    let answer: { tool: string; args: string } | { text: string };
    if (offered.length === 0) answer = { text: 'Scripted' };
    else {
      const step = scripts.get(account)?.shift();
      if (!step) answer = { text: 'Done.' };
      else if ('text' in step) answer = { text: step.text };
      else if (!offered.includes(step.tool)) answer = { text: `Scripted tool ${step.tool} is not offered.` };
      else answer = { tool: step.tool, args: JSON.stringify(step.args) };
    }
    const entries = log.get(account) ?? [];
    entries.push({ lastRole: body.messages?.at(-1)?.role ?? '', tools: offered.length, answered: 'tool' in answer ? answer.tool : 'text' });
    log.set(account, entries);
    const model = body.model ?? 'scripted';
    const message = 'tool' in answer
      ? { role: 'assistant', content: null, tool_calls: [{ id: `call_${entries.length}`, type: 'function', function: { name: answer.tool, arguments: answer.args } }] }
      : { role: 'assistant', content: answer.text };
    const finish = 'tool' in answer ? 'tool_calls' : 'stop';
    if (!body.stream) {
      return res.json({ id: 'fake', object: 'chat.completion', created: 0, model, choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }
    const chunk = (delta: unknown, finishReason: string | null = null) =>
      `data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    if ('tool' in answer) res.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, ...message.tool_calls![0] }] }));
    else res.write(chunk({ role: 'assistant', content: answer.text }));
    res.write(chunk({}, finish));
    res.end('data: [DONE]\n\n');
  });
  return app;
}
