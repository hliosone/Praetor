import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const f = require('../miniprogram/lib/format.js');
const c = require('../miniprogram/lib/countdown.js');
const b = require('../miniprogram/lib/badges.js');

describe('format', () => {
  it('USD values with 6 decimals: two decimals, rounded half up, thousands separated', () => {
    expect(f.usd('10000000000')).toBe('10,000.00');
    expect(f.usd('12500000')).toBe('12.50');
    expect(f.usd('994999')).toBe('0.99');
    expect(f.usd('995000')).toBe('1.00');
    expect(f.usd('0')).toBe('0.00');
    expect(f.usd(BigInt('123456789012345678'))).toBe('123,456,789,012.35');
    expect(f.usd(undefined)).toBe('0.00');
  });

  it('exact token amounts (what is signed): every significant decimal, no rounding', () => {
    expect(f.units('300000000', 6)).toBe('300');
    expect(f.units('300000001', 6)).toBe('300.000001');
    expect(f.units('1200000000', 6)).toBe('1,200');
    expect(f.units('250000000000000000', 18)).toBe('0.25');
    expect(f.units('1', 18)).toBe('0.000000000000000001');
    expect(f.units('0', 6)).toBe('0');
  });

  it('weights in basis points as a percentage with one decimal', () => {
    expect(f.pct(3612)).toBe('36.1%');
    expect(f.pct(10000)).toBe('100.0%');
    expect(f.pct(5)).toBe('0.1%');
    expect(f.pct(0)).toBe('0.0%');
  });

  it('addresses: full, or shortened for lists; Base Sepolia transaction links', () => {
    expect(f.shortAddress('0x00000000000000000000000000000000000c0ffe')).toBe('0x0000…0ffe');
    expect(f.txUrl(`0x${'ab'.repeat(32)}`, 'https://sepolia.basescan.org')).toBe(`https://sepolia.basescan.org/tx/0x${'ab'.repeat(32)}`);
    expect(f.txUrl('nope', 'https://sepolia.basescan.org')).toBe('');
    // No explorer on the local fork (issue #9): no link at all.
    expect(f.txUrl(`0x${'ab'.repeat(32)}`, null)).toBe('');
    expect(f.txUrl(`0x${'ab'.repeat(32)}`)).toBe('');
  });

  it('dates from Base seconds, as YYYY-MM-DD in UTC', () => {
    expect(f.day('1800086400')).toBe('2027-01-16');
  });
});

describe('countdown against Base time', () => {
  it('measures the phone clock offset from Base and counts down to expiresAt', () => {
    // Base says 1_800_000_000 while the phone reads 2 minutes later (a fork can also run ahead).
    const offset = c.clockOffset('1800000000', 1_800_000_120_000);
    expect(offset).toBe(-120_000);
    expect(c.secondsLeft('1800000900', offset, 1_800_000_120_000)).toBe(900);
    expect(c.secondsLeft('1800000900', offset, 1_800_001_020_500)).toBe(0);
    expect(c.secondsLeft('1800000900', offset, 1_800_001_100_000)).toBe(0);
  });

  it('formats seconds as m:ss and durations in words', () => {
    expect(c.mmss(899)).toBe('14:59');
    expect(c.mmss(5)).toBe('0:05');
    expect(c.mmss(-3)).toBe('0:00');
    expect(c.duration('en', 45)).toBe('45 s');
    expect(c.duration('en', 600)).toBe('10 min');
    expect(c.duration('zh-CN', 7200)).toBe('2 小时');
    expect(c.duration('en', 3 * 86400)).toBe('3 d');
  });
});

describe('badges', () => {
  it('tier badges: T0 red, T1 green, T2/T3 amber (waiting for a human), T4 neutral', () => {
    expect(b.tierBadge('T0_NEVER')).toEqual({ cls: 'refused', label: 'T0', key: 'tier.T0_NEVER' });
    expect(b.tierBadge('T1_AUTONOMOUS').cls).toBe('signed');
    expect(b.tierBadge(2)).toEqual({ cls: 'asked', label: 'T2', key: 'tier.T2_HUMAN' });
    expect(b.tierBadge('T3_OWNER').cls).toBe('asked');
    expect(b.tierBadge('T4_CONSORTIUM').cls).toBe('muted');
    expect(b.tierBadge('?').cls).toBe('muted');
  });

  it('activity outcome: executed green, refused needing a human amber, refused for good red', () => {
    expect(b.outcome({ kind: 'decision', reason: 'OK', tier: 'T1_AUTONOMOUS' })).toBe('signed');
    expect(b.outcome({ kind: 'refusal', reason: 'UNKNOWN_PAYEE', tier: 'T2_HUMAN' })).toBe('asked');
    expect(b.outcome({ kind: 'refusal', reason: 'SANCTIONED', tier: 'T0_NEVER' })).toBe('refused');
  });

  it('status pill: FROZEN red, RESTRICTED amber, ACTIVE green unless the heartbeat expired (then amber)', () => {
    expect(b.statusPill({ effective: 'FROZEN', heartbeatValidUntil: '1800000600', now: '1800000000' })).toMatchObject({ cls: 'refused', key: 'status.FROZEN', frozen: true });
    expect(b.statusPill({ effective: 'RESTRICTED', heartbeatValidUntil: '1800000600', now: '1800000000' })).toMatchObject({ cls: 'asked', key: 'status.RESTRICTED' });
    expect(b.statusPill({ effective: 'ACTIVE', heartbeatValidUntil: '1800000600', now: '1800000000' })).toEqual({ cls: 'signed', key: 'status.ACTIVE', frozen: false, heartbeat: { expired: false, seconds: 600 } });
    expect(b.statusPill({ effective: 'ACTIVE', heartbeatValidUntil: '1800000000', now: '1800000300' })).toEqual({ cls: 'asked', key: 'status.STALE', frozen: false, heartbeat: { expired: true, seconds: 300 } });
    expect(b.statusPill({ effective: 'WHATEVER', heartbeatValidUntil: '0', now: '1' }).cls).toBe('refused');
  });
});
