// Adapted from BSA Sentry's test/statement.test.ts (docs/PREEXISTING.md).
import { describe, it, expect } from 'vitest';
import { balanceAt, camtAmount, camt053, camtErrors, statementEntries, type Transfer } from '../src/statement.js';

const ME = '0x00000000000000000000000000000000000c0ffe';
const DESK = '0x00000000000000000000000000000000000000d5';
const RAIL = '0x00000000000000000000000000000000000000aa';
const CAFE = '0x00000000000000000000000000000000000ca4e1';
const at = (h: number) => Date.parse('2026-10-12T00:00:00Z') + h * 3_600_000;
const tx = (n: number) => `0x${n.toString(16).padStart(2, '0').repeat(32)}`;
const transfers: Transfer[] = [
  { txHash: tx(1), at: at(1), from: '0x0000000000000000000000000000000000000000', to: ME, value: 5_000_000_000n },
  { txHash: tx(2), at: at(2), from: ME, to: CAFE, value: 12_500_000n },
  { txHash: tx(3), at: at(3), from: ME, to: RAIL, value: 1_200_000_000n },
  { txHash: tx(4), at: at(4), from: ME, to: DESK, value: 300_000_000n },
  { txHash: tx(5), at: at(5), from: RAIL, to: ME, value: 50_000_000n },
];
const entries = statementEntries(transfers, { account: ME, desk: DESK, payoutRail: RAIL, labels: { [CAFE]: 'Cafe <Lumen> & Co' }, payouts: { [tx(3)]: 'Kowloon Lettings (mock)' } });

describe('statement entries', () => {
  it('books funding, payments, payouts with the merchant name, rebalances and refunds', () => {
    expect(entries.map((e) => [e.direction, e.name, e.category, e.units])).toEqual([
      ['credit', 'USDC issued (test funds)', 'Top-ups', 5_000_000_000n],
      ['debit', 'Cafe <Lumen> & Co', 'Payment', 12_500_000n],
      ['debit', 'Kowloon Lettings (mock)', 'Payout', 1_200_000_000n],
      ['debit', 'Treasury desk', 'Rebalance', 300_000_000n],
      ['credit', 'Payout partner', 'Payout refund', 50_000_000n],
    ]);
  });

  it('works out the balance at any time from the balance now and the history', () => {
    const now = 5_000_000_000n - 12_500_000n - 1_200_000_000n - 300_000_000n + 50_000_000n;
    expect(balanceAt(entries, now, at(0))).toBe(0n);
    expect(balanceAt(entries, now, at(2.5))).toBe(4_987_500_000n);
  });
});

describe('ISO 20022 camt.053', () => {
  const xml = camt053({ account: ME, entries, from: at(0), to: at(6), opening: 0n, closing: 3_537_500_000n, now: at(6), network: 'Base Sepolia', chainId: 84532 });

  it('amounts fit the schema: at most 5 decimals, never negative', () => {
    expect(camtAmount(3_500_000n)).toBe('3.50');
    expect(camtAmount(1_234_567n)).toBe('1.23457');
  });

  it('books debits and credits with their totals and the balances', () => {
    expect(xml).toContain('<TtlCdtNtries><NbOfNtries>2</NbOfNtries><Sum>5050.00</Sum></TtlCdtNtries>');
    expect(xml).toContain('<TtlDbtNtries><NbOfNtries>3</NbOfNtries><Sum>1512.50</Sum></TtlDbtNtries>');
    expect(xml).toMatch(/<Cd>CLBD<\/Cd><\/CdOrPrtry><\/Tp><Amt Ccy="USD">3537.50<\/Amt>/);
    expect(xml).toContain('Cafe &lt;Lumen&gt; &amp; Co');
  });

  it('validates against the camt.053.001.02 schema; a broken document does not', async () => {
    expect(await camtErrors(xml)).toEqual([]);
    expect((await camtErrors(xml.replace('<Sts>BOOK</Sts>', '<Sts>NOPE</Sts>'))).length).toBeGreaterThan(0);
  });
});
