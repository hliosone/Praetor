/** Calls `run` now and again `everyMs` after each run ends (two runs never overlap, however long one takes); a run
 *  that throws is retried after `retryMs` instead. */
export function repeat(run: () => Promise<void>, everyMs: number, retryMs = everyMs): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const next = async () => {
    const ok = await run().then(() => true, () => false);
    if (!stopped) timer = setTimeout(next, ok ? everyMs : retryMs);
  };
  void next();
  return () => { stopped = true; clearTimeout(timer); };
}
