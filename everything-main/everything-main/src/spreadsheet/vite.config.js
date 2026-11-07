import { defineConfig } from 'vite';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  plugins: [puterLocalhost('spreadsheet')],
  base: './',
  build: {
    target: 'es2022',
    cssTarget: 'safari15',
    // SheetJS is ~1 MB of source and only needed when a file is read or
    // written, so io.js imports it dynamically; the warning threshold is
    // raised so that intentional chunk does not trip the build.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // The timeout catches a hang, not a slow machine: a few stress tests (whole-sheet pivots,
    // deeply nested clipboard HTML) take several seconds alone and longer beside 2,000 other files.
    testTimeout: 30000,
  },
});
