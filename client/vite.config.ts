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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
