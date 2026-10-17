// The public pages (landing, onboarding start, console): screenshots at both widths and an axe check of each.
import { test } from '@playwright/test';
import { shoot } from './lib.js';

for (const [name, path] of [['landing', '/'], ['onboarding', '/start'], ['console', '/console'], ['recover', '/recover']] as const) {
  test(`${name}: renders, is accessible, screenshot`, async ({ page }) => {
    await page.goto(path);
    await shoot(page, name);
  });
}
