// The account as a bank statement (spec 06 F8 step 5): every USDC transfer of the Safe booked as a debit or a credit,
// exported as ISO 20022 camt.053.001.02 and validated against the schema before it leaves the api. Adapted from BSA
// Sentry's apps/web/src/state/statement.ts (docs/PREEXISTING.md): Praetor's counterparties are the treasury desk
// (rebalances), the payout rail (merchant payouts and their refunds) and payees.
import { readFileSync } from 'node:fs';
import { validateXML } from 'xmllint-wasm';

export type Transfer = { txHash: string; at: number; from: string; to: string; value: bigint };

export type StatementEntry = {
  txHash: string;
  at: number;
  direction: 'debit' | 'credit';
  counterparty: string;
  name: string;
  category: string;
  units: bigint;
};

const ZERO = '0x0000000000000000000000000000000000000000';
const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

/** Oldest first. `payouts` names the merchant of a payout by its transaction; `labels` are the owner's payee names. */
export function statementEntries(transfers: Transfer[], o: { account: string; desk: string; payoutRail: string; labels?: Record<string, string>; payouts?: Record<string, string> }): StatementEntry[] {
  const me = o.account.toLowerCase();
  const desk = o.desk.toLowerCase();
  const rail = o.payoutRail.toLowerCase();
  const labels = Object.fromEntries(Object.entries(o.labels ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const out: StatementEntry[] = [];
  for (const t of transfers) {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    const base = { txHash: t.txHash.toLowerCase(), at: t.at, units: t.value };
    if (from === me) {
      if (to === desk) out.push({ ...base, direction: 'debit', counterparty: to, name: 'Treasury desk', category: 'Rebalance' });
      else if (to === rail) out.push({ ...base, direction: 'debit', counterparty: to, name: o.payouts?.[base.txHash] ?? 'Payout partner', category: 'Payout' });
      else out.push({ ...base, direction: 'debit', counterparty: to, name: labels[to] ?? short(to), category: 'Payment' });
    } else if (to === me) {
      if (from === desk) out.push({ ...base, direction: 'credit', counterparty: from, name: 'Treasury desk', category: 'Rebalance' });
      else if (from === rail) out.push({ ...base, direction: 'credit', counterparty: from, name: 'Payout partner', category: 'Payout refund' });
      else if (from === ZERO) out.push({ ...base, direction: 'credit', counterparty: from, name: 'USDC issued (test funds)', category: 'Top-ups' });
      else out.push({ ...base, direction: 'credit', counterparty: from, name: labels[from] ?? short(from), category: 'Received' });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The balance at `at`, from the balance now and the full history after it. */
export function balanceAt(all: StatementEntry[], current: bigint, at: number): bigint {
  let b = current;
  for (const e of all) if (e.at > at) b += e.direction === 'debit' ? e.units : -e.units;
  return b;
}

export function totals(entries: StatementEntry[]): { debited: bigint; credited: bigint } {
  let debited = 0n, credited = 0n;
  for (const e of entries) if (e.direction === 'debit') debited += e.units; else credited += e.units;
  return { debited, credited };
}

/** USDC base units (6 dp) as a camt amount: at least 2 decimals, at most the schema's 5. */
export function camtAmount(units: bigint): string {
  const u = units < 0n ? -units : units;
  const r = u % 10n >= 5n ? u / 10n + 1n : u / 10n; // 5 decimals, rounded half up
  const frac = (r % 100_000n).toString().padStart(5, '0').replace(/0{1,3}$/, '');
  return `${r / 100_000n}.${frac}`;
}

const esc = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const dtTm = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * A camt.053.001.02 statement of the account over [from, to]: `entries` are the period's entries, `opening` and
 * `closing` the balances at `from` and `to`. Amounts are USD at 1 USDC = 1 USD (camt needs an ISO 4217 code). EVM
 * addresses (42 chars) do not fit camt's 34-char account id: the id holds a prefix, the name the full address.
 */
export function camt053(o: { account: string; entries: StatementEntry[]; from: number; to: number; opening: bigint; closing: bigint; now: number; network: string; chainId: number }): string {
  const t = totals(o.entries);
  const bal = (cd: string, units: bigint, at: number) =>
    `<Bal><Tp><CdOrPrtry><Cd>${cd}</Cd></CdOrPrtry></Tp><Amt Ccy="USD">${camtAmount(units)}</Amt><CdtDbtInd>${units < 0n ? 'DBIT' : 'CRDT'}</CdtDbtInd><Dt><Dt>${day(at)}</Dt></Dt></Bal>`;
  const wallet = `Praetor account ${o.account}`;
  const party = (nm: string) => `<Nm>${esc(nm)}</Nm>`;
  const credits = o.entries.filter((e) => e.direction === 'credit');
  const debits = o.entries.filter((e) => e.direction === 'debit');

  const entry = (e: StatementEntry) => {
    const debit = e.direction === 'debit';
    const ref = esc(e.txHash.slice(0, 35));
    const other = `${e.name} (${e.counterparty})`;
    return `
      <Ntry>
        <Amt Ccy="USD">${camtAmount(e.units)}</Amt>
        <CdtDbtInd>${debit ? 'DBIT' : 'CRDT'}</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><DtTm>${dtTm(e.at)}</DtTm></BookgDt>
        <ValDt><DtTm>${dtTm(e.at)}</DtTm></ValDt>
        <AcctSvcrRef>${ref}</AcctSvcrRef>
        <BkTxCd>
          <Domn><Cd>PMNT</Cd><Fmly><Cd>${debit ? 'ICDT' : 'RCDT'}</Cd><SubFmlyCd>OTHR</SubFmlyCd></Fmly></Domn>
          <Prtry><Cd>${esc(e.category)}</Cd><Issr>Praetor</Issr></Prtry>
        </BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs><TxId>${ref}</TxId></Refs>
            <RltdPties>
              <Dbtr>${party(debit ? wallet : other)}</Dbtr>
              <Cdtr>${party(debit ? other : wallet)}</Cdtr>
            </RltdPties>
            <RmtInf>
              <Ustrd>${esc(`Category: ${e.category}`)}</Ustrd>
              <Ustrd>USDC on ${esc(o.network)}, 1 USDC = 1 USD</Ustrd>
            </RmtInf>
            <AddtlTxInf>${esc(`${o.network} transaction ${e.txHash}`)}</AddtlTxInf>
          </TxDtls>
        </NtryDtls>
        <AddtlNtryInf>${esc(`${e.name}, ${e.category}`)}</AddtlNtryInf>
      </Ntry>`;
  };

  const net = t.credited - t.debited;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>PRAETOR-${o.now}</MsgId>
      <CreDtTm>${dtTm(o.now)}</CreDtTm>
      <MsgPgntn><PgNb>1</PgNb><LastPgInd>true</LastPgInd></MsgPgntn>
      <AddtlInf>${esc(`Praetor statement of the account ${o.account}. USDC on ${o.network} (chain ${o.chainId}), shown in USD at 1 USDC = 1 USD.`)}</AddtlInf>
    </GrpHdr>
    <Stmt>
      <Id>PRAETOR-STMT-${day(o.from).replace(/-/g, '')}-${day(o.to).replace(/-/g, '')}</Id>
      <ElctrncSeqNb>1</ElctrncSeqNb>
      <CreDtTm>${dtTm(o.now)}</CreDtTm>
      <FrToDt><FrDtTm>${dtTm(o.from)}</FrDtTm><ToDtTm>${dtTm(o.to)}</ToDtTm></FrToDt>
      <Acct>
        <Id><Othr><Id>${esc(o.account.slice(0, 34))}</Id><SchmeNm><Prtry>EVM address prefix</Prtry></SchmeNm></Othr></Id>
        <Ccy>USD</Ccy>
        <Nm>${esc(wallet)}</Nm>
        <Svcr><FinInstnId><Nm>${esc(`${o.network}, USDC`)}</Nm><Othr><Id>eip155:${o.chainId}</Id><SchmeNm><Prtry>CAIP-2 chain</Prtry></SchmeNm></Othr></FinInstnId></Svcr>
      </Acct>
      ${bal('OPBD', o.opening, o.from)}
      ${bal('CLBD', o.closing, o.to)}
      <TxsSummry>
        <TtlNtries><NbOfNtries>${o.entries.length}</NbOfNtries><TtlNetNtryAmt>${camtAmount(net)}</TtlNetNtryAmt><CdtDbtInd>${net < 0n ? 'DBIT' : 'CRDT'}</CdtDbtInd></TtlNtries>
        <TtlCdtNtries><NbOfNtries>${credits.length}</NbOfNtries><Sum>${camtAmount(t.credited)}</Sum></TtlCdtNtries>
        <TtlDbtNtries><NbOfNtries>${debits.length}</NbOfNtries><Sum>${camtAmount(t.debited)}</Sum></TtlDbtNtries>
      </TxsSummry>${o.entries.map(entry).join('')}
    </Stmt>
  </BkToCstmrStmt>
</Document>
`;
}

const XSD = new URL('../assets/camt.053.001.02.xsd', import.meta.url);
let schema: string | undefined;

/** Schema errors of a camt.053.001.02 document (empty when valid). */
export async function camtErrors(xml: string): Promise<string[]> {
  schema ??= readFileSync(XSD, 'utf8');
  const r = await validateXML({ xml: [{ fileName: 'statement.xml', contents: xml }], schema: [{ fileName: 'camt.053.001.02.xsd', contents: schema }] });
  return r.valid ? [] : r.errors.map((e) => e.message);
}
