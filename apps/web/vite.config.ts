// The web app (spec 07): built to dist/ and served by Caddy at the public host; in development Vite proxies the api.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022', sourcemap: false },
  server: { proxy: { '/api': { target: 'https://praetor.localhost', secure: false, changeOrigin: false } } },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
