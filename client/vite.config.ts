// client/vite.config.ts — Vite build and dev-server configuration for the NodeToolbox React SPA.
//
// In development (port 5173) all backend API paths are proxied to the
// Express server at port 5555, so the React app talks to the real backend
// without any CORS issues or manual environment switching.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // Absolute import alias so all modules use '@/' instead of '../../../'
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    port: 5173,
    proxy: {
      // Forward all backend routes to the Express server at port 5555.
      // This mirrors the production configuration where Express handles
      // these paths directly (no Vite in the middle).
      '/api': {
        target: 'http://localhost:5555',
        changeOrigin: true,
      },
      '/jira-proxy': {
        target: 'http://localhost:5555',
        changeOrigin: true,
      },
      '/snow-proxy': {
        target: 'http://localhost:5555',
        changeOrigin: true,
      },
      '/github-proxy': {
        target: 'http://localhost:5555',
        changeOrigin: true,
      },
      '/setup': {
        target: 'http://localhost:5555',
        changeOrigin: true,
      },
    },
  },

  build: {
    // Output to client/dist — Express picks this up in production
    outDir: 'dist',
    sourcemap: true,
  },

  test: {
    // Vitest runs in a simulated browser environment so React hooks and
    // DOM queries work without a real browser.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Vitest's default is 5s. Several whole-journey tests here drive a real component tree from an
    // empty tab to a created Jira issue and take ~3s on an IDLE machine — so with 632 files competing
    // for the CPU they were being starved and timing out, in a different file each run.
    //
    // Raised globally rather than per file, which was the first attempt and the wrong shape: the point
    // of contention is that it does not choose its victim in advance, so naming files could only ever
    // chase the last one to fail. A genuine hang still fails, ten seconds later than it used to.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
