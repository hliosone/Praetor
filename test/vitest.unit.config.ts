import { defineConfig } from 'vitest/config';

// Static checks of the repo itself (compose, docs skeleton, guards) and the pure parts of the red-team suite: fast, no
// running stack.
export default defineConfig({
  test: { include: ['infra/**/*.test.ts', 'redteam/unit/**/*.unit.test.ts'], testTimeout: 30_000 },
});
