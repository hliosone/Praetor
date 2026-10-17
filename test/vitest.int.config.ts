import { defineConfig } from 'vitest/config';

// One file per architecture link, against the running stack (`make up`).
export default defineConfig({
  test: { include: ['integration/**/*.test.ts'], testTimeout: 180_000, hookTimeout: 180_000, fileParallelism: false },
});
