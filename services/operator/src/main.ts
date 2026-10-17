// operator-service (member: operator): heartbeat job and the member API (spec 05). The audit writer and anchor
// proposer arrive with M11.
import { z } from 'zod';
import { baseClients, baseNow } from '@praetor/chain';
import { startMember, type MemberContext } from '@praetor/member-kit';
import { heartbeatOnce, serialized } from './heartbeat.js';

export function startOperator(env: Record<string, string | undefined> = process.env) {
  const cfg = z.object({
    HEARTBEAT_INTERVAL_S: z.coerce.number().int().positive().default(60),
    HEARTBEAT_TTL_S: z.coerce.number().int().positive().max(86_400).default(180),
    BASE_RPC_URL: z.string().url(),
  }).parse(env);
  const { publicClient } = baseClients(cfg.BASE_RPC_URL);
  const now = () => baseNow(publicClient);
  // The job and a manual beat share one queue: the status board holds one open heartbeat proposal at a time.
  let beat: ((c: MemberContext['consortium']) => ReturnType<typeof heartbeatOnce>) | undefined;
  const beatOnce = (c: MemberContext['consortium']) => (beat ??= serialized((x: MemberContext['consortium']) => heartbeatOnce(x, now, cfg.HEARTBEAT_TTL_S)))(c);
  return startMember({
    role: 'operator',
    env,
    extend: (r, ctx) => {
      r.post('/heartbeat/beat', async (_req, res, next) => {
        try {
          const b = await beatOnce(ctx.consortium);
          res.json({ proposalId: b.proposalId.toString(), ready: b.ready, validUntil: b.validUntil.toString() });
        } catch (e) {
          next(e);
        }
      });
    },
    jobs: (ctx) => {
      let busy = false;
      const t = setInterval(() => {
        if (busy) return;
        busy = true;
        beatOnce(ctx.consortium)
          .then((b) => ctx.log.info({ proposalId: b.proposalId.toString(), validUntil: b.validUntil.toString() }, 'heartbeat'))
          .catch((e) => ctx.log.warn({ error: (e as Error).message.split('\n')[0] }, 'heartbeat failed'))
          .finally(() => { busy = false; });
      }, cfg.HEARTBEAT_INTERVAL_S * 1000);
      return () => clearInterval(t);
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startOperator().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
