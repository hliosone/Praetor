// V6 fake LLM: an OpenAI-compatible /v1/chat/completions that replays a script, for deterministic tests.
// Turn 1 (last message from the user, praetor tool offered): call praetor_get_balance.
// Turn 2 (last message is the tool result): answer with text quoting the result. Anything else: short text.
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 19012);
const log = (...a) => console.log(new Date().toISOString(), ...a);

function decide(body) {
  const msgs = body.messages ?? [];
  const last = msgs[msgs.length - 1] ?? {};
  const tools = (body.tools ?? []).map((t) => t.function?.name);
  if (last.role === 'user' && tools.includes('praetor_get_balance')) return { tool: { name: 'praetor_get_balance', args: '{}' } };
  if (last.role === 'tool') return { text: `Scripted answer. Tool said: ${typeof last.content === 'string' ? last.content : JSON.stringify(last.content)}` };
  return { text: 'Scripted title' };
}

function chunk(model, delta, finish = null) {
  return `data: ${JSON.stringify({ id: 'fake-1', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  if (req.url?.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'scripted', object: 'model' }] })); return; }
  const body = raw ? JSON.parse(raw) : {};
  const d = decide(body);
  log(`${req.method} ${req.url} stream=${!!body.stream} tools=${(body.tools ?? []).length} last=${body.messages?.at(-1)?.role} -> ${d.tool ? `tool ${d.tool.name}` : 'text'}`);
  const model = body.model ?? 'scripted';
  if (!body.stream) {
    const message = d.tool
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: d.tool.name, arguments: d.tool.args } }] }
      : { role: 'assistant', content: d.text };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'fake-1', object: 'chat.completion', created: 0, model,
      choices: [{ index: 0, message, finish_reason: d.tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  if (d.tool) {
    res.write(chunk(model, { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: d.tool.name, arguments: d.tool.args } }] }));
    res.write(chunk(model, {}, 'tool_calls'));
  } else {
    res.write(chunk(model, { role: 'assistant', content: d.text }));
    res.write(chunk(model, {}, 'stop'));
  }
  res.end('data: [DONE]\n\n');
}).listen(PORT, '127.0.0.1', () => log(`fake llm on 127.0.0.1:${PORT}`));
