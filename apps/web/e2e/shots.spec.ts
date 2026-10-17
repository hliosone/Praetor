// Screenshots of the public pages (docs/screens), and an axe check of each: no serious or critical violation.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const [name, path] of [['landing', '/'], ['onboarding', '/start'], ['console', '/console']] as const) {
  test(`${name}: renders, is accessible, screenshot`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `../../docs/screens/${name}.png`, fullPage: true });
    const axe = await new AxeBuilder({ page }).analyze();
    const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
