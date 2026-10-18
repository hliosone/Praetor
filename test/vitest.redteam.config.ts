import { defineConfig } from 'vitest/config';

// Red-team suite (spec 08) against the running stack: one entry file per driver (redteam/suite/), cases in order.
export default defineConfig({
  test: { include: ['redteam/suite/**/*.test.ts'], testTimeout: 900_000, hookTimeout: 3_600_000, fileParallelism: false, passWithNoTests: true },
});
