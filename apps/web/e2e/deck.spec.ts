// The pitch deck's screenshots with one realistic account (DECK_SHOTS=1, on a fresh fork, after the journey: both
// write the same files in docs/screens/web). Lin signs up in the browser as in the demo (video script, "The fork"),
// after the consortium bootstrap, demo prices, attester and desk liquidity of `pnpm seed`: an account seeded through
// the member services has no api login. Her agent runs the stack's scripted model so every shot is reproducible.
// Lin is funded so that every weight stays inside its band through the payments, the gold shock, the rebalance and
// the rent: 5,900 USDC, 3,700 USD of tXAU, 1,400 USD of tXAG.
import { execFileSync } from 'node:child_process';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { erc20Abi, type Address } from 'viem';
import { standingOrdersEventsAbi } from '@praetor/protocol';
import {
  activateSoterAttester, bootstrapConsortium, ensureDeskLiquidity, fund, labelAddress, lastAgentTurn, pub, root, scriptAgent, setDemoPrices, stack,
  waitFor, waitHeartbeat, type Stack,
} from '../../../scripts/demo/lib.js';
import { kycMockSubmit } from '../../../scripts/demo/web.js';
import { approveStaffKey, type StaffKey } from '../../../scripts/demo/staff.js';
import { shoot, withPasskeys } from './lib.js';

const tag = Date.now().toString(36);
const CAFE = labelAddress(`deck-cafe-${tag}`);
const POWER = labelAddress(`deck-power-${tag}`);
const DENTIST = labelAddress(`deck-dentist-${tag}`);
let s: Stack;
let owner: BrowserContext;
let page: Page;
let account: Address;

const usdcOf = (a: Address) => pub(s).readContract({ address: s.base.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [a] });
const status = () => page.getByTestId('status');

test.describe('deck screenshots', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(process.env.DECK_SHOTS !== '1', 'deck screenshots: DECK_SHOTS=1 on a fresh fork');

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    s = stack();
    await bootstrapConsortium(s);
    await setDemoPrices(s);
    await activateSoterAttester(s);
    await ensureDeskLiquidity(s);
    owner = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
    page = await owner.newPage();
    await withPasskeys(owner, page);
  });

  test.afterAll(async () => { await setDemoPrices(s); });

  test('Lin signs up, funds her account and names her payees', async () => {
    test.setTimeout(900_000);
    await page.goto('/');
    await shoot(page, 'landing');
    await page.goto('/start');
    await page.getByLabel('Email').fill(`lin-${tag}@example.com`);
    await page.getByRole('button', { name: 'Create my passkey' }).click();
    const safe = page.locator('section.panel p.muted .mono');
    await expect(safe).toHaveText(/^0x[0-9a-fA-F]{40}$/);
    account = (await safe.textContent()) as Address;
    await page.getByRole('button', { name: 'Create my wallet' }).click();
    await page.getByRole('button', { name: 'Verify with the Demo KYC provider' }).click();
    const kycUrl = await page.locator('.notice a').getAttribute('href');
    for (const p of owner.pages()) if (p !== page) await p.close();
    await kycMockSubmit(kycUrl!, { fullName: 'Lin Wei', birthdate: '1990-04-02', nationality: 'HK', documentNumber: `UI${tag}` });
    await page.getByRole('button', { name: 'Save my profile' }).click({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Create my agent in the TEE' }).click();
    await page.getByRole('button', { name: 'Sign with Face ID' }).click();
    await page.getByRole('button', { name: 'Set my policy' }).click({ timeout: 240_000 });
    await expect(page.getByText('Your agent is ready.')).toBeVisible({ timeout: 120_000 });
    await scriptAgent(s, account, []);
    const { agentKey } = await (await page.request.get('/api/agent')).json();
    await fund(s, { address: account, owner: undefined as never, agent: agentKey }, 5_900_000_000n, 3_700_000_000n, 1_400_000_000n);
    await waitHeartbeat(s);
    for (const [name, address] of [['Café Lumen', CAFE], ['Harbour Power & Water', POWER]] as const) {
      await page.goto('/payments');
      await page.getByLabel('Name').fill(name);
      await page.getByLabel('Address').fill(address);
      await page.getByRole('button', { name: 'Add a payee' }).click();
      await expect(page.getByText(`${name} added to your payees.`)).toBeVisible({ timeout: 180_000 });
    }
  });

  test('her agent pays two known payees alone and asks her about a new one', async () => {
    test.setTimeout(600_000);
    const chats: [string, Record<string, unknown>, string][] = [
      ["Pay Café Lumen for this morning's coffee, 12.50.", { payee: 'Café Lumen', amount: '12.50', memo: 'coffee' }, 'Paid 12.50 USDC to Café Lumen for the coffee.'],
      ['The electricity bill came in: 86.40 to Harbour Power & Water.', { payee: 'Harbour Power & Water', amount: '86.40', memo: 'electricity bill' }, 'Paid 86.40 USDC to Harbour Power & Water.'],
      [`Please pay the dentist 380 USDC for my check-up, to ${DENTIST}.`, { payee: DENTIST, amount: '380', memo: 'dental check-up' },
        'This one needs you: the dentist is not one of your payees, and 380 USDC is more than the 200 I may pay alone. I sent you an approval request.'],
    ];
    await page.goto('/agent');
    for (const [message, args, answer] of chats) {
      await scriptAgent(s, account, [{ tool: 'praetor_pay', args }, { text: answer }]);
      await page.getByLabel('Ask how you are doing, or ask it to pay or rebalance').fill(message);
      await page.getByRole('button', { name: 'Send' }).click();
      await expect(page.locator('.bubble.agent').last()).toContainText(answer, { timeout: 180_000 });
    }
    expect(await usdcOf(CAFE)).toBe(12_500_000n);
    expect(await usdcOf(POWER)).toBe(86_400_000n);
    expect(await usdcOf(DENTIST)).toBe(0n);
    await shoot(page, 'agent');
    await page.goto('/home');
    await page.locator('a.card[href^="/approve/"]').first().click({ timeout: 60_000 });
    await expect(page.getByTestId('approval-what')).toHaveText(new RegExp(`Pay 380.00 USDC to ${DENTIST}`, 'i'));
    await expect(page.getByTestId('approval-why').locator('li')).toHaveCount(2);
    await shoot(page, 'approve');
  });

  test('gold jumps 20%, the scheduler wakes her agent, it rebalances alone', async () => {
    test.setTimeout(600_000);
    await scriptAgent(s, account, [
      { tool: 'praetor_get_portfolio', args: {} },
      { tool: 'praetor_rebalance', args: { sell: 'tXAU', buy: 'USDC', amountUsd: '650' } },
      { text: 'Gold rose above its 35% limit, so I sold 650 USD of tXAU for USDC. Your portfolio is back inside its bands.' },
    ], 'wake');
    execFileSync('pnpm', ['-s', 'shock', '--asset', 'XAU', '--pct', '20'], { cwd: root, stdio: 'inherit' });
    const turn = await waitFor('the rebalance after the wake', async () => {
      const t = await lastAgentTurn(s, account);
      return t && t.tools.some((x) => x.tool === 'praetor_rebalance') ? t : undefined;
    }, 360_000);
    // The demo shock ends here, as the feeder would end it after its hold: the shots after it are at the seeded prices.
    await setDemoPrices(s);
    const tx = /0x[0-9a-fA-F]{64}/.exec(String(turn.tools.find((x) => x.tool === 'praetor_rebalance')!.output))![0];
    await page.goto('/home');
    await expect(page.getByText(tx.slice(0, 10), { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await shoot(page, 'home');
  });

  test('the rent to Kowloon Lettings: a standing order through Alipay+, paid when due', async () => {
    test.setTimeout(480_000);
    await page.goto('/payments');
    await page.getByLabel('Amount (USDC)').fill('1200');
    await page.getByRole('button', { name: 'Add a standing order' }).click();
    await expect(page.getByText('Standing order set on Base.')).toBeVisible({ timeout: 180_000 });
    await waitFor('the rent paid on Base', async () => (await pub(s).getLogs({ address: s.base.standingOrders, event: standingOrdersEventsAbi[2], args: { account }, fromBlock: BigInt(s.base.deployBlock) })).length > 0, 180_000);
    await page.goto('/payments');
    await expect(page.locator('tbody tr', { hasText: 'Kowloon Lettings' }).first()).toBeVisible({ timeout: 30_000 });
    await shoot(page, 'payments');
    await page.goto('/mandate');
    await expect(page.getByText(/Known payees: 2/)).toBeVisible({ timeout: 30_000 });
    await shoot(page, 'mandate');
  });

  test('the audit trail: anchored on Base, verified against FISCO', async () => {
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
  });

  test('the regulator freezes her account with one signature', async ({ browser }) => {
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
    await regulator.getByRole('button', { name: 'Freeze' }).click();
    await regulator.locator('[data-testid^="proposal-regulator-"]').first().getByRole('button', { name: 'Sign with my passkey' }).click();
    await expect(regulator.getByText('Ready: the bridge delivers it to Base.')).toBeVisible({ timeout: 60_000 });
    await page.goto('/home');
    await expect(status()).toHaveText('Frozen', { timeout: 180_000 });
    await expect(page.getByTestId('frozen-banner')).toBeVisible();
    await shoot(page, 'home-frozen');
    await shoot(cons, 'console-freeze');
    await staff.close();
  });
});
