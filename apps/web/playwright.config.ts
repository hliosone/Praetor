// Playwright (spec 10 M13): the web app against the local stack through Caddy (https://praetor.localhost, Caddy's
// internal CA), with Chrome's virtual authenticator standing in for Face ID. Screenshots land in docs/screens.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 600_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.WEB_URL ?? 'https://praetor.localhost',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
