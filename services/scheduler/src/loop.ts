/** Calls `run` now and again `everyMs` after each run ends: two runs never overlap, however long one takes. */
export function repeat(run: () => Promise<void>, everyMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const next = async () => {
    await run().catch(() => undefined);
    if (!stopped) timer = setTimeout(next, everyMs);
  };
  void next();
  return () => { stopped = true; clearTimeout(timer); };
}
