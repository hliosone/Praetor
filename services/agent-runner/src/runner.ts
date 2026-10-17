// One agent turn on an account's OpenCode instance: the permission rejector starts before the message is sent (a
// pending request would otherwise hang the turn) and rejects every built-in tool call (Q34).
import type { Instance, InstanceManager } from './instances.js';

export type ToolStep = { tool: string; status: string; input: unknown; output: unknown };
export type TurnResult = { text: string; tools: ToolStep[]; sessionId: string };

type Part = { type: string; text?: string; tool?: string; state?: { status?: string; input?: unknown; output?: unknown; error?: unknown } };
type Message = { info: { role: string }; parts: Part[] };

export class Runner {
  private sessions = new Map<string, string>();
  private queues = new Map<string, Promise<unknown>>();

  constructor(private readonly m: InstanceManager, private readonly turnTimeoutMs = 180_000) {}

  /** Turns of one account run one at a time. */
  turn(account: string, text: string): Promise<TurnResult> {
    const key = account.toLowerCase();
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.run(key, text));
    this.queues.set(key, next);
    return next;
  }

  async transcript(account: string): Promise<Message[]> {
    const i = await this.m.ensure(account);
    const s = this.sessions.get(account.toLowerCase());
    return s ? ((await this.call(i, 'GET', `/session/${s}/message`)) as Message[]) : [];
  }

  private async call(i: Instance, method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<unknown> {
    const sep = path.includes('?') ? '&' : '?';
    const r = await fetch(`${i.base}${path}${sep}directory=${encodeURIComponent(i.project)}`, {
      method, headers: { authorization: i.auth, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`opencode ${method} ${path}: ${r.status}`);
    return r.json();
  }

  private async run(account: string, text: string): Promise<TurnResult> {
    const i = await this.m.ensure(account);
    i.busy++;
    let rejecting = true;
    const rejector = (async () => {
      while (rejecting) {
        const pending = (await this.call(i, 'GET', '/permission').catch(() => [])) as { id: string }[];
        for (const p of pending) await this.call(i, 'POST', `/permission/${p.id}/reply`, { reply: 'reject' }).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 200));
      }
    })();
    try {
      let session = this.sessions.get(account);
      if (!session) {
        session = ((await this.call(i, 'POST', '/session', { title: `praetor ${account}` })) as { id: string }).id;
        this.sessions.set(account, session);
      }
      const [providerID, ...rest] = i.model.split('/');
      const before = ((await this.call(i, 'GET', `/session/${session}/message`).catch(() => [])) as Message[]).length;
      const last = (await this.call(i, 'POST', `/session/${session}/message`, { model: { providerID, modelID: rest.join('/') }, parts: [{ type: 'text', text }] }, this.turnTimeoutMs)) as Message;
      const all = (await this.call(i, 'GET', `/session/${session}/message`)) as Message[];
      const turn = all.slice(before).filter((m) => m.info.role === 'assistant');
      const tools = turn.flatMap((m) => m.parts.filter((p) => p.type === 'tool').map((p) => ({ tool: p.tool ?? '', status: p.state?.status ?? '', input: p.state?.input, output: p.state?.output ?? p.state?.error })));
      const finalText = last.parts.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('').trim();
      return { text: finalText, tools, sessionId: session };
    } finally {
      rejecting = false;
      await rejector;
      i.busy--;
      this.m.release(account);
    }
  }
}
