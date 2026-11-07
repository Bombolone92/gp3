import { defineConfig } from 'vitest/config';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  plugins: [puterLocalhost('email')],
  base: './',
  build: {
    target: 'es2022',
    cssTarget: 'safari15',
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['tests/setup.js'],
    include: ['tests/**/*.test.js'],
  },
});
