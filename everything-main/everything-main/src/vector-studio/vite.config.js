import { defineConfig } from 'vite';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  plugins: [puterLocalhost('vector-studio')],
  base: './',
  build: {
    target: 'es2022',
    cssTarget: 'safari16',
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: '127.0.0.1',
    port: 5563,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    // axe and full-app boots are slow on a loaded machine; avoid spurious timeouts.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
