import { useCallback, useEffect, useState } from 'react';

/** Data from the api, reloadable; `every` polls (the dashboard follows the chain). */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = [], every?: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const reload = useCallback(() => load().then((d) => { setData(d); setError(undefined); }, (e: Error) => setError(e.message)), deps);
  useEffect(() => {
    void reload();
    if (!every) return;
    const t = setInterval(() => void reload(), every);
    return () => clearInterval(t);
  }, [reload, every]);
  return { data, error, reload };
}
