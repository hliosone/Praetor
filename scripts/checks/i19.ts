// I19 scan core (spec 01: no personal data on Base). Pure: bytes in, matches out. Two kinds of search:
// - the seeded values of the demo and the tests (i19-seeded.ts), as raw bytes anywhere (ASCII case folded), so a
//   string packed into a bytes32 topic is found whatever its length;
// - generic patterns (emails, phones, birthdates, passport and ID numbers, IBANs) and the per-run seeded families,
//   only on printable runs (ASCII or valid UTF-8) of at least MIN_RUN characters.
// False positives are kept out by construction: addresses, hashes and ABI words are binary, and random bytes rarely
// form long printable runs; every pattern needs non-alphanumeric boundaries (no digits inside hex text), phones need a
// "+" or separators (never a bare digit run like an amount), birthdates need a real calendar date with a year from
// 1900 to 2019 (no timestamps, no expiries), and IBANs and mainland resident IDs need their checksum.
import { hexToBytes, type Hex } from 'viem';
import { FIXTURE, type Fixture } from './i19-seeded.js';

export const MIN_RUN = 6;
export const BIRTH_YEARS = [1900, 2019] as const;

export type Run = { text: string; offset: number };
export type Match = { rule: string; match: string; offset: number };
export type TxItem = { hash: Hex; to: Hex | null; input: Hex };
export type LogItem = { address: Hex; transactionHash: Hex; logIndex: number; topics: Hex[]; data: Hex };
export type Finding = Match & { where: string };

const PRINTABLE = /^[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]$/u;

/** The code point starting at i and its length in bytes, when it is printable ASCII, a tab or newline, or a printable UTF-8 character. */
function charAt(b: Uint8Array, i: number): { cp: number; len: number } | null {
  const x = b[i]!;
  if ((x >= 0x20 && x <= 0x7e) || x === 0x09 || x === 0x0a || x === 0x0d) return { cp: x, len: 1 };
  const cont = (j: number, lo = 0x80, hi = 0xbf) => i + j < b.length && b[i + j]! >= lo && b[i + j]! <= hi;
  let cp: number;
  let len: number;
  if (x >= 0xc2 && x <= 0xdf && cont(1)) [cp, len] = [((x & 0x1f) << 6) | (b[i + 1]! & 0x3f), 2];
  else if (x >= 0xe0 && x <= 0xef && cont(1, x === 0xe0 ? 0xa0 : 0x80, x === 0xed ? 0x9f : 0xbf) && cont(2))
    [cp, len] = [((x & 0x0f) << 12) | ((b[i + 1]! & 0x3f) << 6) | (b[i + 2]! & 0x3f), 3];
  else if (x >= 0xf0 && x <= 0xf4 && cont(1, x === 0xf0 ? 0x90 : 0x80, x === 0xf4 ? 0x8f : 0xbf) && cont(2) && cont(3))
    [cp, len] = [((x & 0x07) << 18) | ((b[i + 1]! & 0x3f) << 12) | ((b[i + 2]! & 0x3f) << 6) | (b[i + 3]! & 0x3f), 4];
  else return null;
  return PRINTABLE.test(String.fromCodePoint(cp)) ? { cp, len } : null;
}

type IndexedRun = Run & { pos: number[] };

/** Printable runs with, for each UTF-16 unit of the text, the offset of its byte in the input. */
function runsWithPositions(bytes: Uint8Array, min: number): IndexedRun[] {
  const runs: IndexedRun[] = [];
  let cur: IndexedRun | null = null;
  let chars = 0;
  const flush = () => {
    if (cur && chars >= min) runs.push(cur);
    cur = null;
    chars = 0;
  };
  for (let i = 0; i < bytes.length;) {
    const c = charAt(bytes, i);
    if (!c) {
      flush();
      i++;
      continue;
    }
    cur ??= { text: '', offset: i, pos: [] };
    const s = String.fromCodePoint(c.cp);
    cur.text += s;
    for (let k = 0; k < s.length; k++) cur.pos.push(i);
    chars++;
    i += c.len;
  }
  flush();
  return runs;
}

export function printableRuns(bytes: Uint8Array, min = MIN_RUN): Run[] {
  return runsWithPositions(bytes, min).map(({ text, offset }) => ({ text, offset }));
}

function validDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const birth = (y: number, m: number, d: number) => y >= BIRTH_YEARS[0] && y <= BIRTH_YEARS[1] && validDate(y, m, d);

// GB 11643: 17 digits, then a check character from the weighted sum modulo 11; digits 7 to 14 are the birth date.
const CN_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
function cnResidentId(s: string): boolean {
  const sum = CN_WEIGHTS.reduce((a, w, i) => a + w * Number(s[i]), 0);
  return '10X98765432'[sum % 11] === s[17] && validDate(Number(s.slice(6, 10)), Number(s.slice(10, 12)), Number(s.slice(12, 14))) && Number(s.slice(6, 10)) >= 1900;
}

// ISO 13616: the first four characters moved to the end, letters as 10 to 35, the number modulo 97 is 1.
function iban(s: string): boolean {
  const c = s.replace(/ /g, '');
  if (c.length < 15 || c.length > 34) return false;
  let r = 0;
  for (const ch of c.slice(4) + c.slice(0, 4)) {
    const v = ch >= 'A' ? ch.charCodeAt(0) - 55 : Number(ch);
    r = (v > 9 ? r * 100 + v : r * 10 + v) % 97;
  }
  return r === 1;
}

type Rule = { rule: string; pattern: RegExp; check?: (m: RegExpMatchArray) => boolean };
const n = (s: string | undefined) => Number(s);
export const RULES: Rule[] = [
  { rule: 'email', pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![A-Za-z0-9-])/g },
  // E.164 with optional single separators (9 to 15 digits), or 3-3-4 groups with separators.
  { rule: 'phone', pattern: /(?<![0-9A-Za-z+])\+\d(?:[ .-]?\d){8,14}(?![0-9A-Za-z])/g },
  { rule: 'phone', pattern: /(?<![0-9A-Za-z])(?:\(\d{3}\) ?|\d{3}[-. ])\d{3}[-. ]\d{4}(?![0-9A-Za-z])/g },
  { rule: 'birthdate', pattern: /(?<![0-9])(\d{4})([-/.])(\d{2})\2(\d{2})(?![0-9])/g, check: (m) => birth(n(m[1]), n(m[3]), n(m[4])) },
  { rule: 'birthdate', pattern: /(?<![0-9])(\d{2})([-/.])(\d{2})\2(\d{4})(?![0-9])/g, check: (m) => birth(n(m[4]), n(m[3]), n(m[1])) || birth(n(m[4]), n(m[1]), n(m[3])) },
  // Passports and most national IDs (one or two letters, 6 to 9 digits, an optional HKID check digit), mainland resident IDs.
  { rule: 'id-number', pattern: /(?<![A-Za-z0-9])[A-Z]{1,2}\d{6,9}(?:\([0-9A]\))?(?![A-Za-z0-9])/g },
  { rule: 'id-number', pattern: /(?<![A-Za-z0-9])\d{17}[\dX](?![A-Za-z0-9])/g, check: (m) => cnResidentId(m[0]) },
  { rule: 'iban', pattern: /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}(?![A-Za-z0-9])/g, check: (m) => iban(m[0]) },
];

const foldAscii = (b: Uint8Array) => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x >= 0x41 && x <= 0x5a ? x + 32 : x);
  return s;
};

export function scanBytes(bytes: Uint8Array, fixture: Fixture = FIXTURE): Match[] {
  const out: Match[] = [];
  const hay = foldAscii(bytes);
  const utf8 = new TextDecoder();
  for (const s of fixture.values) {
    const needle = new TextEncoder().encode(s.value);
    const folded = foldAscii(needle);
    for (let i = hay.indexOf(folded); i >= 0; i = hay.indexOf(folded, i + 1)) {
      out.push({ rule: `seeded:${s.field}`, match: utf8.decode(bytes.subarray(i, i + needle.length)), offset: i });
    }
  }
  const rules: Rule[] = [...fixture.families.map((f) => ({ rule: `family:${f.name}`, pattern: f.pattern })), ...RULES];
  for (const run of runsWithPositions(bytes, MIN_RUN)) {
    for (const r of rules) {
      for (const m of run.text.matchAll(r.pattern)) {
        if (r.check && !r.check(m)) continue;
        out.push({ rule: r.rule, match: m[0], offset: run.pos[m.index!]! });
      }
    }
  }
  return out;
}

/** Every transaction's calldata and every log's topics and data, with where each finding is. */
export function scanBase(input: { txs: TxItem[]; logs: LogItem[] }, fixture: Fixture = FIXTURE) {
  const findings: Finding[] = [];
  let bytes = 0;
  const scan = (h: Hex, where: string) => {
    const b = hexToBytes(h);
    bytes += b.length;
    for (const m of scanBytes(b, fixture)) findings.push({ ...m, where });
  };
  for (const t of input.txs) scan(t.input, `tx ${t.hash} input`);
  for (const l of input.logs) {
    l.topics.forEach((t, i) => scan(t, `log ${l.transactionHash}#${l.logIndex} topic${i}`));
    scan(l.data, `log ${l.transactionHash}#${l.logIndex} data`);
  }
  return { txs: input.txs.length, logs: input.logs.length, bytes, findings };
}
