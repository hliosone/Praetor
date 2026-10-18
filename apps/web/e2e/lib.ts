// Shared by the Playwright specs: Chrome's virtual authenticator standing in for Face ID / Touch ID, and a
// screenshot of a route at 1440 px and 390 px with an axe check (spec 07 UI tests).
import { createHash } from 'node:crypto';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const SHOTS = '../../docs/screens/web';

/** A platform authenticator with user verification, so passkey prompts complete without a human. */
export async function withPasskeys(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

/** docs/screens/web/<name>-1440.png and -390.png (no sideways scroll at 390 px), then no serious or critical axe violation. */
export async function shoot(page: Page, name: string) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/${name}-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${name}-390.png`, fullPage: true });
  // No horizontal page scroll on a phone (#3): long hashes wrap and tables scroll inside their own box. Soft, so one
  // wide page does not hide the next.
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth), `${name}: page width at 390 px`).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1440, height: 900 });
  const axe = await new AxeBuilder({ page }).analyze();
  const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${name} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** The fake Tencent's "device signature" (services/soter-attester/src/fake-tencent.ts): the mini program stand-in. */
export const fakeSoterSignature = (openid: string, jsonString: string) =>
  createHash('sha256').update(`fake-soter|${openid}|${jsonString}`).digest('base64');
