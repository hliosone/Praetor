// A transaction hash, linked to the explorer the api names in /config. The local fork has no public explorer (issue #9):
// the short hash then carries a "local fork" label and no link, instead of a Basescan page that does not know it.
import { useEffect, useState } from 'react';
import { txText } from '@praetor/protocol';
import { useI18n } from '../i18n/index.js';
import { api } from '../lib/api.js';

let explorer: Promise<string | null> | undefined;
/** The explorer base URL from /config, fetched once per page load; null on the fork or when /config fails. */
export function useExplorer(): string | null | undefined {
  const [v, setV] = useState<string | null>();
  useEffect(() => {
    explorer ??= api<{ explorer?: string | null }>('GET', '/config').then((c) => c.explorer ?? null, () => null);
    let live = true;
    void explorer.then((e) => { if (live) setV(e); });
    return () => { live = false; };
  }, []);
  return v;
}

export function TxLink({ hash, explorer }: { hash: string; explorer: string | null | undefined }) {
  const { t } = useI18n();
  const short = hash.slice(0, 10);
  if (!explorer) return <span className="mono" title={hash}>{short}{explorer === null && <span className="muted small"> ({t('common.localFork')})</span>}</span>;
  return <a className="mono" href={txText(explorer, hash)} target="_blank" rel="noopener">{short}</a>;
}
