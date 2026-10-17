import { defineConfig } from 'vitest/config';

// Static checks of the repo itself (compose, docs skeleton, guards): fast, no running stack.
export default defineConfig({
  test: { include: ['infra/**/*.test.ts'], testTimeout: 30_000 },
});
