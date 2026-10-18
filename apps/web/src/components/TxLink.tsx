// A Base transaction: a link to the explorer the api names in /config, or, on the local fork, whose transactions no
// public explorer knows, the short hash marked as such (#9). Nothing links before /config answers.
import { useI18n } from '../i18n/index.js';

export function TxLink({ hash, explorer }: { hash: string; explorer: string | null | undefined }) {
  const { t } = useI18n();
  const short = hash.slice(0, 10);
  if (explorer) return <a className="mono" href={`${explorer}/tx/${hash}`} target="_blank" rel="noopener">{short}</a>;
  return <><span className="mono" title={hash}>{short}</span>{explorer === null && <span className="muted"> ({t('common.localFork')})</span>}</>;
}
