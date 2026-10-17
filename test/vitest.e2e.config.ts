import { defineConfig } from 'vitest/config';

// Flows F1 to F10 (spec 06) against BASE_URL.
export default defineConfig({
  test: { include: ['e2e/**/*.test.ts'], testTimeout: 600_000, hookTimeout: 600_000, fileParallelism: false, passWithNoTests: true },
});
