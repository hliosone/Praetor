// The personal values the demo and the tests seed (I19 scan fixture): what must never be found in Base calldata or
// events. Collected from the code; keep in step when a seed changes. Values built from a per-run tag
// (`Date.now().toString(36)`, 8 base-36 characters) cannot be listed one by one: their fixed parts are the families.

export type Field = 'name' | 'birthdate' | 'document' | 'email' | 'label' | 'merchant' | 'memo';
export type SeededValue = { value: string; field: Field; source: string };
export type SeededFamily = { name: string; field: Field; pattern: RegExp; source: string };
export type Fixture = { values: SeededValue[]; families: SeededFamily[] };

// The M16 evidence run (D96) on Base Sepolia: live-run.ts derives its person and email from the tag `mvddfobg`, found
// offline from the run's start time (2026-10-18T05:14:49.180Z): it is the only tag near it whose
// labelAddress(`evidence-cafe-${tag}`) is the run's Cafe Lumen payee 0x7b4AFf8c1855724f120BD750A1Df5E4AF7CAE269.
export const M16_TAG = 'mvddfobg';

const v = (field: Field, source: string, ...values: string[]): SeededValue[] => values.map((value) => ({ value, field, source }));

export const SEEDED_VALUES: SeededValue[] = [
  ...v('name', 'services/bank/test/kyc.test.ts, services/kyc-vendor-mock/test/mock.test.ts', 'Lin Wei'),
  ...v('name', 'services/bank/test/kyc-routes.test.ts', 'Test Person'),
  ...v('name', 'services/bank/src/sanctions-mock.ts, kyc.test.ts, F1, bank-kyc', 'Blockedov Ivan', 'Ivan Blockedov', 'Demo Sanctioned Person', 'Viktor Frozenko', 'Mallory Embargo'),
  ...v('name', 'scripts/demo/lib.ts demoPerson', 'Demo Person'),
  ...v('name', 'scripts/evidence/live-run.ts (M16)', `Zqevidence Lin${M16_TAG}`),
  ...v('birthdate', 'demo, e2e, integration, redteam, bank and EUDI tests',
    '1990-04-02', '1990-01-01', '1990-01-15', '1991-03-04', '1987-05-06', '1988-01-02', '1985-09-10', '1985-03-04', '1989-05-06',
    '1992-07-08', '1979-11-23', '2010-01-01', '2015-01-15'),
  ...v('document', 'services/bank/test/kyc.test.ts, services/kyc-vendor-mock/test/mock.test.ts', 'K1234567', 'Z9999999'),
  ...v('document', 'scripts/evidence/live-run.ts (M16)', `EV${M16_TAG}`),
  ...v('email', 'services/api/test', 'lin@example.com', 'lin.private@example.com', 'x@example.com', 'y@example.com', 'nobody@example.com'),
  ...v('email', 'scripts/demo/web.ts onboardViaApi (M16)', `evidence-${M16_TAG}@example.com`),
  ...v('label', 'scripts/evidence/live-run.ts, test/e2e/F5, apps/web/e2e, test/redteam', 'Café Lumen', 'Landlord', 'Utilities', 'Mallory', 'Escrow'),
  ...v('merchant', 'test/e2e/F7, scripts/evidence/live-run.ts, payout-partner', 'KOWLOON-LETTINGS', 'Kowloon Lettings', 'HK-ELECTRIC', 'HK Electric', 'DECLINE-TEST', 'Decline test merchant'),
  ...v('memo', 'test/e2e/F5, apps/web/e2e, test/redteam', 'rent october', 'coffee'),
  ...v('label', 'apps/web/e2e/deck.spec.ts', 'Harbour Power & Water'),
  ...v('memo', 'apps/web/e2e/deck.spec.ts', 'electricity bill', 'dental check-up'),
];

// Not searched, on purpose: `X1` (kyc-routes.test.ts) is two characters and would match by chance; nationalities
// (`HK`, `CN`, `FR`, `CH`, `IT`, `DE`) are on Base by design as the KYA jurisdiction and the ERC-3643 identity country.
export const NOT_SEARCHED = ['X1', 'HK', 'CN', 'FR', 'CH', 'IT', 'DE'];

const TAG = '[0-9a-z]{8}';
export const SEEDED_FAMILIES: SeededFamily[] = [
  // Every per-run test person is `Zq<word> <Word><tag>` (F1 to F10, the web journey, bank-kyc, the red team, M16).
  { name: 'test person name', field: 'name', pattern: /Zq[a-z0-9]{1,15} [A-Za-z]{2,}/g, source: 'test/e2e, test/warp, test/integration/bank-kyc, test/redteam, apps/web/e2e, live-run.ts' },
  // Document numbers: F1<tag>, F2, F3, F5<tag>DOC, F6, F7, F8, F10, F10W, EV, UI, RT<tag><case>, X<tag> (F10 re-KYC).
  { name: 'test document number', field: 'document', pattern: new RegExp(`(?<![A-Za-z0-9])(?:F(?:10W|10|[1-8])|EV|UI|RT|X)${TAG}`, 'g'), source: 'test/e2e, test/warp, test/redteam, apps/web/e2e, live-run.ts' },
  // bank-kyc: K<4 random bytes hex>X; demoPerson: D<8 hex of keccak256(label)>.
  { name: 'test document number (hex)', field: 'document', pattern: /(?<![A-Za-z0-9])(?:K[0-9a-f]{8}X|D[0-9a-f]{8})(?![A-Za-z0-9])/g, source: 'test/integration/bank-kyc.test.ts, scripts/demo/lib.ts demoPerson' },
  // Sign-up emails: <flow>-<tag>@example.com, evidence-<tag>@example.com, ui-<tag>@example.com (also caught as emails).
  { name: 'test email', field: 'email', pattern: /[a-z0-9.-]{1,40}@example\.com/gi, source: 'scripts/demo/web.ts, test/e2e, apps/web/e2e' },
];

export const FIXTURE: Fixture = { values: SEEDED_VALUES, families: SEEDED_FAMILIES };

// On Base by design (spec 02, 03, D69), so the scan never reports them: addresses (accounts, payees, agent keys),
// amounts and other numbers, hashes and identifiers (policyHash, callHash, merchantRef = keccak256(merchantId),
// payment and settlement references, identityHash = kycCredentialHash, agentDidHash, fiscoRef, audit heads, credential
// id hashes), KYA kycLevel and riskProfile (uint8), the two-letter jurisdiction (bytes2, e.g. 0x484b "HK") and the
// ERC-3643 identity country (bytes2, F1 step 13), EIP-712 domain names, token names and symbols, WebAuthn
// clientDataJSON (type, base64url challenge, origin) inside passkey signatures.
export const ALLOWED_BY_DESIGN = [
  'addresses', 'amounts and numbers', 'hashes and identifiers', 'KYA kycLevel and riskProfile', 'two-letter jurisdiction (bytes2)',
  'ERC-3643 identity country (bytes2)', 'EIP-712 domain names, token names and symbols', 'WebAuthn clientDataJSON in passkey signatures',
] as const;
