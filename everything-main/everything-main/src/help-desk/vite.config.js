import { defineConfig } from 'vite';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  base: './',
  plugins: [puterLocalhost('help-desk')],
  build: {
    target: 'es2022',
    cssTarget: 'safari15',
    rollupOptions: {
      input: { main: 'index.html' },
    },
  },
  server: {
    port: 5291,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
  },
});
