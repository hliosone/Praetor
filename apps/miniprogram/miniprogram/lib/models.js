// View models: plain data for WXML, built from the api's answers. Words and colours come from the outcome, the tier
// and the reason codes; what an approval covers comes from its decoded calldata, never from the api's summary.
const format = require('./format.js');
const badges = require('./badges.js');
const i18n = require('./i18n.js');
const calls = require('./calls.js');
const countdown = require('./countdown.js');
const verify = require('./verify.js');

function reasonText(lang, reason) {
  const key = `reason.${reason}`;
  const s = i18n.t(lang, key);
  return s === key ? i18n.t(lang, 'reason.unknown', { code: reason }) : s;
}

function pill(lang, status) {
  const p = badges.statusPill(status);
  const d = countdown.duration(lang, p.heartbeat.seconds);
  return { cls: p.cls, label: i18n.t(lang, p.key), heartbeat: i18n.t(lang, p.heartbeat.expired ? 'status.heartbeatAgo' : 'status.heartbeatLeft', { d }), frozen: p.frozen };
}

function activityRows(lang, items, explorer) {
  return items.map((it) => {
    const tier = badges.tierBadge(it.tier);
    return {
      cls: badges.outcome(it), tier: tier.label, tierText: i18n.t(lang, tier.key), text: reasonText(lang, it.reason),
      amount: it.valueUsd6 ? format.usd(it.valueUsd6) : '', target: format.shortAddress(it.target), tx: it.txHash, url: format.txUrl(it.txHash, explorer),
      // On the local fork there is no explorer to link to: the row says so instead (issue #9).
      local: !!it.txHash && !explorer,
    };
  });
}

/** One line per pending approval: the call its call hash binds, decoded here, and why it needs the owner. */
function pendingRows(lang, approvals, config) {
  return approvals.map((a) => {
    const c = verify.checkApproval(a, { config, account: a.tier2.account, nowS: 0, lang });
    return { id: a.id, text: c.callIndex >= 0 ? calls.describe(lang, c.decoded[c.callIndex], { short: true }) : '', why: reasonText(lang, a.reason) };
  });
}

function homeModel(lang, r) {
  const p = pill(lang, r.status);
  return {
    total: format.usd(r.portfolio.totalUsd6),
    assets: r.portfolio.assets.map((a) => ({ symbol: a.symbol, weight: format.pct(a.weightBps), value: format.usd(a.valueUsd6), demo: !!a.demoPrice })),
    pill: { cls: p.cls, label: p.label, heartbeat: p.heartbeat },
    frozen: p.frozen,
    decisions: activityRows(lang, r.activity.items, r.config && r.config.explorer),
    pending: pendingRows(lang, r.approvals.approvals, r.config),
  };
}

const RESULT_KEYS = { executed: 'approve.executed', failed: 'approve.failed', rejected: 'approve.rejected', expired: 'approve.expired', pending: 'approve.pendingState' };
const resultText = (lang, state) => i18n.t(lang, RESULT_KEYS[state] || 'approve.pendingState');

function periodText(lang, seconds) {
  if (Number(seconds) === 7 * 86400) return i18n.t(lang, 'payments.period.weekly');
  if (Number(seconds) === 30 * 86400) return i18n.t(lang, 'payments.period.monthly');
  return i18n.t(lang, 'payments.period.days', { n: Math.round(Number(seconds) / 86400) });
}

function ordersModel(lang, r) {
  return {
    orders: r.orders.map((o) => ({
      id: o.id, to: o.merchant || format.shortAddress(o.payee), rail: i18n.t(lang, `rail.${['USDC_DIRECT', 'ALIPAY_PLUS', 'WECHAT_PAY'][o.rail] || 'USDC_DIRECT'}`),
      amount: format.units(o.amount, 6), every: i18n.t(lang, 'payments.every', { period: periodText(lang, o.period) }),
      next: o.active ? i18n.t(lang, 'payments.nextDue', { date: format.day(o.nextDue) }) : i18n.t(lang, 'payments.inactive'), active: !!o.active,
    })),
    proposals: r.proposals.filter((x) => x.state === 'pending').map((x) => ({ id: x.id, text: x.summary })),
  };
}

module.exports = { reasonText, pill, activityRows, pendingRows, homeModel, resultText, ordersModel, periodText };
