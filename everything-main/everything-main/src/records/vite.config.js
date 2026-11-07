import { defineConfig } from 'vite';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  plugins: [puterLocalhost('records')],
  base: './',
  build: {
    target: 'es2022',
    cssTarget: 'safari15',
  },
  server: {
    port: 5261,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
  },
});
