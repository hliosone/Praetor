// Numbers for the screens, from the api's decimal strings (spec 02 units: USD with 6 decimals, metals with 18). Integer
// arithmetic only: a signed amount is shown exactly, never through a float.
const toBig = (v) => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === 'string' && /^[0-9]+$/.test(v)) return BigInt(v);
  return BigInt(0);
};

const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** USD value (6 decimals) with two decimals, rounded half up: totals and balances. */
function usd(v6) {
  const cents = (toBig(v6) + BigInt(5000)) / BigInt(10000);
  const s = cents.toString().padStart(3, '0');
  return `${group(s.slice(0, -2))}.${s.slice(-2)}`;
}

/** An exact token amount with every significant decimal: what an approval signs. */
function units(amount, decimals) {
  const s = toBig(amount).toString().padStart(decimals + 1, '0');
  const whole = group(s.slice(0, s.length - decimals));
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/** Basis points as a percentage with one decimal. */
function pct(bps) {
  const tenths = Math.round(Number(bps) / 10);
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

function shortAddress(a) {
  return typeof a === 'string' && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : String(a);
}

function txUrl(hash) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(hash)) ? `https://sepolia.basescan.org/tx/${hash}` : '';
}

/** A Base timestamp (seconds) as YYYY-MM-DD, UTC. */
function day(seconds) {
  return new Date(Number(seconds) * 1000).toISOString().slice(0, 10);
}

module.exports = { usd, units, pct, shortAddress, txUrl, day, toBig };
