import { defineConfig } from 'vitest/config';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  plugins: [puterLocalhost('parametric')],
  base: './',
  build: {
    target: 'es2022',
    cssTarget: 'safari16',
    // The geometry kernel is a large, separately cached WebAssembly module.
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: 0,
  },
  server: {
    host: '127.0.0.1',
    port: 5581,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['replicad-opencascadejs'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
