import type { ConsortiumPort } from '@praetor/member-kit';

/** One heartbeat: valid until the latest Base block time + TTL (spec 02: Base-bound times come from Base), signed by
 *  the operator itself (an automated signature, D24). Silence lets it expire: the hook then treats the agent as
 *  RESTRICTED (I4). */
export async function heartbeatOnce(c: Pick<ConsortiumPort, 'deadline' | 'open' | 'sign'>, baseNow: () => Promise<bigint>, ttlSeconds: number) {
  const validUntil = (await baseNow()) + BigInt(ttlSeconds);
  const { proposalId } = await c.open('status', 'openHeartbeat', [validUntil, await c.deadline()]);
  const { ready } = await c.sign('status', proposalId);
  return { proposalId, ready, validUntil };
}

/** Runs calls of `fn` one after another (the job and a manual beat share it), whatever the previous outcome. */
export function serialized<A extends unknown[], R>(fn: (...a: A) => Promise<R>): (...a: A) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return (...a: A) => {
    const run = tail.then(() => fn(...a), () => fn(...a));
    tail = run.catch(() => undefined);
    return run;
  };
}
