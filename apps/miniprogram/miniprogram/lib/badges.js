// The three outcome colours of spec 07, each with one meaning: signed (green, executed), asked (amber, waiting for a
// human), refused (red, refused or frozen). Anything unknown is drawn neutral, never green.
const TIERS = ['T0_NEVER', 'T1_AUTONOMOUS', 'T2_HUMAN', 'T3_OWNER', 'T4_CONSORTIUM'];
const TIER_CLS = { T0_NEVER: 'refused', T1_AUTONOMOUS: 'signed', T2_HUMAN: 'asked', T3_OWNER: 'asked' };

function tierBadge(tier) {
  const name = typeof tier === 'number' ? TIERS[tier] : tier;
  if (TIERS.indexOf(name) < 0) return { cls: 'muted', label: '?', key: 'tier.unknown' };
  return { cls: TIER_CLS[name] || 'muted', label: name.slice(0, 2), key: `tier.${name}` };
}

/** Colour of an activity row: what happened, not only the tier. */
function outcome(item) {
  if (item.kind === 'decision' && item.reason === 'OK') return 'signed';
  return item.tier === 'T2_HUMAN' || item.tier === 'T3_OWNER' ? 'asked' : 'refused';
}

/** The status pill: FROZEN red, RESTRICTED amber, ACTIVE green while the consortium heartbeat is valid. */
function statusPill(s) {
  const left = Number(s.heartbeatValidUntil) - Number(s.now);
  const heartbeat = { expired: left <= 0, seconds: Math.abs(left) };
  if (s.effective === 'ACTIVE') return heartbeat.expired ? { cls: 'asked', key: 'status.STALE', frozen: false, heartbeat } : { cls: 'signed', key: 'status.ACTIVE', frozen: false, heartbeat };
  if (s.effective === 'RESTRICTED') return { cls: 'asked', key: 'status.RESTRICTED', frozen: false, heartbeat };
  return { cls: 'refused', key: 'status.FROZEN', frozen: true, heartbeat };
}

module.exports = { tierBadge, outcome, statusPill };
