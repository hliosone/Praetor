// The demo journey through the web app (spec 10 M13 gate: flows F1 to F9 through the UI). One user, Chrome's
// virtual authenticator as Face ID; the consortium console in a second browser with its own staff passkeys. The
// agent runs the stack's scripted model so each turn is deterministic (the real model is the product: M16). Every
// route is screenshot at 1440 px and 390 px and checked with axe on the way.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { erc20Abi, type Address, type Hex } from 'viem';
import { MandateHookAbi } from '@praetor/chain';
import { soterChallenge } from '@praetor/protocol';
import {
  activateSoterAttester, bootstrapConsortium, ensureDeskLiquidity, fund, labelAddress, lastAgentTurn, pub, scriptAgent, setDemoPrices, shockPrice, stack,
  waitFor, waitHeartbeat, type Stack,
} from '../../../scripts/demo/lib.js';
import { kycMockSubmit } from '../../../scripts/demo/web.js';
import { approveStaffKey, type StaffKey } from '../../../scripts/demo/staff.js';
import { fakeSoterSignature, shoot, withPasskeys } from './lib.js';

test.describe.configure({ mode: 'serial' });

const tag = Date.now().toString(36);
const API = process.env.API_URL_HOST ?? 'http://10.88.0.80:3200';
const CAFE = labelAddress(`ui-cafe-${tag}`);
const NEW_PAYEE = labelAddress(`ui-new-payee-${tag}`);
let s: Stack;
let owner: BrowserContext;
let page: Page;
let account: Address;

const usdcOf = (a: Address) => pub(s).readContract({ address: s.base.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [a] });
const status = () => page.getByTestId('status');

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  s = stack();
  await bootstrapConsortium(s);
  await setDemoPrices(s);
  await ensureDeskLiquidity(s);
  await activateSoterAttester(s);
  owner = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  page = await owner.newPage();
  await withPasskeys(owner, page);
});

// The F4 shock moves every account holding tXAU: restore the demo prices whatever happened.
test.afterAll(async () => { await setDemoPrices(s); });

test('F1 onboarding: passkey, wallet, KYC, profile, agent in the TEE, mandate, policy', async () => {
  test.setTimeout(600_000);
  await page.goto('/start');
  await page.getByLabel('Email').fill(`ui-${tag}@example.com`);
  await page.getByRole('button', { name: 'Create my passkey' }).click();
  const safe = page.locator('section.panel p.muted .mono');
  await expect(safe).toHaveText(/^0x[0-9a-fA-F]{40}$/);
  account = (await safe.textContent()) as Address;
  await page.getByRole('button', { name: 'Create my wallet' }).click();
  await page.getByRole('button', { name: 'Verify with the Demo KYC provider' }).click();
  // The provider's hosted page is the vendor's, not ours: submit it the way that page does, then follow the decision.
  const kycUrl = await page.locator('.notice a').getAttribute('href');
  for (const p of owner.pages()) if (p !== page) await p.close();
  await kycMockSubmit(kycUrl!, { fullName: `Zquiperson Journey${tag}`, birthdate: '1991-03-04', nationality: 'HK', documentNumber: `UI${tag}` });
  await page.getByRole('button', { name: 'Save my profile' }).click({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Create my agent in the TEE' }).click();
  await shoot(page, 'onboarding-mandate');
  await page.getByRole('button', { name: 'Sign with Face ID' }).click();
  await page.getByRole('button', { name: 'Set my policy' }).click({ timeout: 240_000 });
  await expect(page.getByText('Your agent is ready.')).toBeVisible({ timeout: 120_000 });
  // Automated run: the agent answers with the scripted model, nothing queued until a step below queues it.
  await scriptAgent(s, account, []);
  const { agentKey } = await (await page.request.get('/api/agent')).json();
  await fund(s, { address: account, owner: undefined as never, agent: agentKey });
  await waitHeartbeat(s);
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(status()).toHaveText('Active', { timeout: 60_000 });
  await expect(page.getByTestId('total')).not.toHaveText('$0.00');
  await shoot(page, 'home');
});

test('F4 rebalancing: a gold shock wakes the agent, its rebalance shows in the decision feed', async () => {
  test.setTimeout(480_000);
  await scriptAgent(s, account, [
    { tool: 'praetor_get_portfolio', args: {} },
    { tool: 'praetor_rebalance', args: { sell: 'tXAU', buy: 'USDC', amountUsd: '650' } },
    { text: 'Sold 650 USD of gold: it was above its 35% max.' },
  ], 'wake');
  await shockPrice(s, 'XAU', 20);
  const turn = await waitFor('the rebalance after the wake', async () => {
    const t = await lastAgentTurn(s, account);
    return t && t.tools.some((x) => x.tool === 'praetor_rebalance') ? t : undefined;
  }, 360_000);
  await setDemoPrices(s);
  const tx = /0x[0-9a-fA-F]{64}/.exec(String(turn.tools.find((x) => x.tool === 'praetor_rebalance')!.output))![0];
  await page.goto('/home');
  // The rebalance is one transaction with two decisions (approve, swap): its link shows on both rows.
  await expect(page.getByRole('link', { name: tx.slice(0, 10) }).first()).toBeVisible({ timeout: 60_000 });
});

test('F3 mandate: the owner raises the autonomous cap; FISCO check, passkey, bank, Base', async () => {
  test.setTimeout(300_000);
  await page.goto('/mandate');
  await page.getByLabel('Pay alone up to (USDC)').fill('250');
  await page.getByRole('button', { name: 'Propose changes' }).click();
  await expect(page.getByText('Mandate updated on Base.')).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText('250.00 USDC')).toBeVisible({ timeout: 30_000 });
  await shoot(page, 'mandate');
});

test('F5 agent payment: a named payee joins the mandate, the agent pays it alone (T1)', async () => {
  test.setTimeout(300_000);
  await page.goto('/payments');
  await page.getByLabel('Name').fill('Café Lumen');
  await page.getByLabel('Address').fill(CAFE);
  await page.getByRole('button', { name: 'Add a payee' }).click();
  await expect(page.getByText('Café Lumen added to your payees.')).toBeVisible({ timeout: 180_000 });
  await scriptAgent(s, account, [
    { tool: 'praetor_pay', args: { payee: 'Café Lumen', amount: '12.50', memo: 'coffee' } },
    { text: 'Paid 12.50 USDC to Café Lumen.' },
  ]);
  const before = await usdcOf(CAFE);
  await page.goto('/agent');
  await page.getByLabel('Ask how you are doing, or ask it to pay or rebalance').fill('Pay the café 12.50');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.bubble.agent').last()).toContainText('Paid 12.50 USDC to Café Lumen.', { timeout: 180_000 });
  expect(await usdcOf(CAFE)).toBe(before + 12_500_000n);
  await shoot(page, 'agent');
});

test('F6 approval: a new payee is T2, the owner approves the exact call with Face ID, it executes once', async () => {
  test.setTimeout(300_000);
  await scriptAgent(s, account, [{ tool: 'praetor_pay', args: { payee: NEW_PAYEE, amount: '300' } }, { text: 'Waiting for your approval.' }]);
  await page.goto('/agent');
  await page.getByLabel('Ask how you are doing, or ask it to pay or rebalance').fill(`Pay 300 USDC to ${NEW_PAYEE}`);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.bubble.agent').last()).toContainText('Waiting for your approval.', { timeout: 180_000 });
  await page.goto('/home');
  await page.locator('a.card[href^="/approve/"]').first().click({ timeout: 60_000 });
  await expect(page.getByTestId('approval-what')).toHaveText(new RegExp(`Pay 300.00 USDC to ${NEW_PAYEE}`, 'i'));
  await shoot(page, 'approve');
  const before = await usdcOf(NEW_PAYEE);
  await page.getByRole('button', { name: 'Approve with Face ID' }).click();
  await expect(page.getByTestId('approval-state')).toHaveText('executed', { timeout: 180_000 });
  expect(await usdcOf(NEW_PAYEE)).toBe(before + 300_000_000n);
});

test('F2 WeChat link: QR, SOTER in the mini program (fixture), passkey confirmation, binding on Base', async () => {
  test.setTimeout(300_000);
  await page.goto('/settings');
  const started = page.waitForResponse((r) => r.url().endsWith('/api/wechat/link/start'));
  await page.getByRole('button', { name: 'Link WeChat' }).click();
  const { id, digest } = (await (await started).json()) as { id: string; digest: Hex };
  await expect(page.getByAltText('WeChat link QR code')).toBeVisible();
  const code = `ui-${tag}`;
  const resultJSON = JSON.stringify({ raw: soterChallenge(digest), counter: 1, uid: `uid-${tag}`, cpu_id: `cpu-${tag}` });
  const mp = await fetch(`${API}/mp/link/${id}/soter`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, resultJSON, resultJSONSignature: fakeSoterSignature(`openid-of-${code}`, resultJSON), authMode: 'facial' }),
  });
  expect(mp.status).toBe(200);
  await shoot(page, 'settings');
  await page.getByRole('button', { name: 'Confirm with my passkey' }).click();
  await expect(page.getByText('WeChat linked on Base.')).toBeVisible({ timeout: 180_000 });
  const binding = await pub(s).readContract({ address: s.base.mandateHook, abi: MandateHookAbi, functionName: 'bindingOf', args: [account] });
  expect(binding).not.toBe(`0x${'00'.repeat(32)}`);
});

test('F7 standing order: rent to a merchant (owner + bank), paid when due through the payout rail', async () => {
  test.setTimeout(300_000);
  await page.goto('/payments');
  await page.getByLabel('Amount (USDC)').fill('1200');
  await page.getByRole('button', { name: 'Add a standing order' }).click();
  await expect(page.getByText('Standing order set on Base.')).toBeVisible({ timeout: 180_000 });
  const row = page.locator('tbody tr', { hasText: 'Kowloon Lettings' }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: 'Pay now if due' }).click();
  await expect(page.getByText('Paid.')).toBeVisible({ timeout: 180_000 });
  await shoot(page, 'payments');
});

test('F8 audit: anchored on Base, verified against FISCO and the anchor, camt.053 export', async () => {
  test.setTimeout(300_000);
  await waitFor('anchor opened and co-signed', async () => {
    const r = await fetch(`${s.members.operator}/audit/anchor`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.env.INTERNAL_TOKEN_MEMBERS}` } });
    return r.status === 200;
  }, 120_000);
  await page.goto('/audit');
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
  await waitFor('Verified on the audit page', async () => {
    await page.getByRole('button', { name: 'Verify' }).click();
    const v = page.getByTestId('verdict');
    await v.waitFor({ timeout: 30_000 });
    return /Verified/.test((await v.textContent()) ?? '');
  }, 180_000);
  await shoot(page, 'audit');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export camt.053' }).click();
  const xml = await (await (await download).createReadStream()).toArray();
  expect(Buffer.concat(xml).toString('utf8')).toContain('BkToCstmrStmt');
});

test('F9 governance: the regulator freezes with one signature, loosening needs two of three', async ({ browser }) => {
  test.setTimeout(600_000);
  const staff = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const cons = await staff.newPage();
  await withPasskeys(staff, cons);
  await cons.goto('/console');
  for (const role of ['regulator', 'bank'] as const) {
    const panel = cons.getByTestId(`console-${role}`);
    await panel.getByRole('button', { name: 'Enrol this device' }).click();
    const key = JSON.parse((await cons.getByTestId(`enrol-${role}`).textContent())!) as StaffKey;
    await approveStaffKey(s, role, key, `console-${role}-${tag}`);
    await panel.getByRole('button', { name: `Sign in as ${role} staff` }).click();
    await expect(panel.getByRole('button', { name: 'Freeze' })).toBeVisible();
  }
  await cons.locator('tbody tr', { hasText: account }).getByRole('button', { name: 'Select' }).click();
  const regulator = cons.getByTestId('console-regulator');
  const bank = cons.getByTestId('console-bank');

  await regulator.getByRole('button', { name: 'Freeze' }).click();
  await regulator.locator('[data-testid^="proposal-regulator-"]').first().getByRole('button', { name: 'Sign with my passkey' }).click();
  await expect(regulator.getByText('Ready: the bridge delivers it to Base.')).toBeVisible({ timeout: 60_000 });
  await page.goto('/home');
  await expect(status()).toHaveText('Frozen', { timeout: 180_000 });
  await shoot(page, 'home-frozen');
  await shoot(cons, 'console-freeze');

  await regulator.getByRole('button', { name: 'Loosen' }).click();
  const card = regulator.locator('[data-testid^="proposal-regulator-"]').first();
  const id = (await card.getAttribute('data-testid'))!.replace('proposal-regulator-', '');
  await card.getByRole('button', { name: 'Sign with my passkey' }).click();
  await expect(regulator.getByText('Signed: waiting for another member.')).toBeVisible({ timeout: 60_000 });
  await bank.getByTestId(`proposal-bank-${id}`).getByRole('button', { name: 'Sign with my passkey' }).click();
  await expect(bank.getByText('Ready: the bridge delivers it to Base.')).toBeVisible({ timeout: 60_000 });
  await expect(status()).toHaveText('Active', { timeout: 180_000 });
  await staff.close();
});

test('F10 rotation: the next agent key reviewed on the agent page, its mandate signed with Face ID, installed on Base', async () => {
  test.setTimeout(480_000);
  await page.goto('/agent');
  const before = (await page.getByTestId('agent-key').textContent({ timeout: 60_000 }))!;
  await page.getByRole('button', { name: 'Rotate key' }).click();
  const shown = page.getByTestId('new-agent-key');
  await expect(shown).toHaveText(/^0x[0-9a-fA-F]{40}$/, { timeout: 180_000 });
  const next = (await shown.textContent())!;
  expect(next.toLowerCase()).not.toBe(before.toLowerCase());
  await page.getByRole('button', { name: 'Sign with Face ID' }).click();
  await expect(page.getByText('New agent key installed.')).toBeVisible({ timeout: 360_000 });
  const [onBase] = await pub(s).readContract({ address: s.base.mandateHook, abi: MandateHookAbi, functionName: 'kyaOf', args: [account] });
  expect(onBase.toLowerCase()).toBe(next.toLowerCase());
  await page.goto('/settings');
  await expect(page.getByText('active').first()).toBeVisible({ timeout: 60_000 });
  await shoot(page, 'settings-devices');
});
