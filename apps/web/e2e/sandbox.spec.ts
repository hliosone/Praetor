// The judges' sandbox (interim, D48): one click creates a funded demo account with the browser's passkey (the
// virtual authenticator here), then the deterministic scenarios run: a rent standing order and the audit check. The
// agent scenarios use the real model and are a MANUAL step.
import { test, expect } from '@playwright/test';
import { shoot, withPasskeys } from './lib.js';

test('sandbox: a demo account in one click, then a standing order and the audit check', async ({ browser }) => {
  test.setTimeout(600_000);
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await withPasskeys(context, page);
  await page.goto('/sandbox');
  await shoot(page, 'sandbox');
  await page.getByRole('button', { name: 'Create a demo account' }).click();
  await expect(page.getByTestId('sandbox-account')).toHaveText(/^0x[0-9a-fA-F]{40}$/, { timeout: 480_000 });
  await expect(page.getByText('5,000 USDC (demo)')).toBeVisible();
  await page.getByRole('button', { name: 'Run a rent standing order' }).click();
  await expect(page.getByRole('cell', { name: 'Paid' })).toBeVisible({ timeout: 180_000 });
  await page.getByRole('button', { name: 'Verify the audit chain' }).click();
  await expect(page.getByText(/Verified: the entries match/)).toBeVisible({ timeout: 60_000 });
  await shoot(page, 'sandbox-scenarios');
  await context.close();
});
