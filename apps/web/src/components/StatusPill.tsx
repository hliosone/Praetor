import { useI18n } from '../i18n/index.js';
import type { Status } from '../lib/api.js';

const CLASS = { ACTIVE: 'ok', RESTRICTED: 'wait', FROZEN: 'no' } as const;

/** ACTIVE green, RESTRICTED amber, FROZEN red. */
export function StatusPill({ status }: { status: Status }) {
  const { t } = useI18n();
  return <span className={`pill ${CLASS[status.effective]}`} data-testid="status">{t(`status.${status.effective}`)}</span>;
}

const TIER = { T1_AUTONOMOUS: 'ok', T2_HUMAN: 'wait', T3_OWNER: 'wait', T4_CONSORTIUM: 'no', T0_NEVER: 'no' } as Record<string, string>;
export function TierBadge({ tier }: { tier: string }) {
  return <span className={`pill ${TIER[tier] ?? 'wait'}`}>{tier.split('_')[0]}</span>;
}
