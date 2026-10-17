import { defineConfig } from 'vitest/config';

// Flows that move the fork's clock forward (F10 recovery after 48 h): run alone, after every other flow.
export default defineConfig({
  test: { include: ['warp/**/*.test.ts'], testTimeout: 600_000, hookTimeout: 600_000, fileParallelism: false },
});
