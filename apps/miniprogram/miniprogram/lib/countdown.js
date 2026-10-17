// Expiries are Base times (spec 02: services date everything from the latest Base block, and a fork moves with time
// warps), so the countdown runs on the phone clock corrected by its offset from Base, measured when the page loads.
const i18n = require('./i18n.js');

/** Milliseconds to add to the phone clock to read Base time. */
function clockOffset(baseNowS, phoneNowMs) {
  return Number(baseNowS) * 1000 - phoneNowMs;
}

function secondsLeft(expiresAt, offsetMs, phoneNowMs) {
  return Math.max(0, Math.floor(Number(expiresAt) - (phoneNowMs + offsetMs) / 1000));
}

function mmss(s) {
  const n = Math.max(0, Math.floor(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

/** A rough duration in words: 45 s, 10 min, 2 h, 3 d. */
function duration(lang, s) {
  const n = Math.max(0, Math.floor(s));
  if (n < 60) return i18n.t(lang, 'time.s', { n });
  if (n < 3600) return i18n.t(lang, 'time.min', { n: Math.floor(n / 60) });
  if (n < 86400) return i18n.t(lang, 'time.h', { n: Math.floor(n / 3600) });
  return i18n.t(lang, 'time.d', { n: Math.floor(n / 86400) });
}

module.exports = { clockOffset, secondsLeft, mmss, duration };
