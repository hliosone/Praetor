// Red-team cases that change shared state for real (REDTEAM_GLOBAL=1, on a stack nobody else is using): an asset every
// account holds, the oracle's price age, the global status. Each change is restored in afterAll.
import { describe, it } from 'vitest';
import { GLOBAL } from '../cases/index.js';
import { redteamSuite } from '../lib/suite.js';

if (process.env.REDTEAM_GLOBAL === '1') {
  redteamSuite({
    name: 'global', driver: 'scripted', cases: GLOBAL, pass: ['BLOCKED'],
    afterRun: async (ctx) => {
      for (const restore of ctx.restores.reverse()) await restore();
    },
  });
} else {
  describe.skip('red team (global): set REDTEAM_GLOBAL=1', () => {
    it('changes shared state', () => undefined);
  });
}
