import { defineConfig } from 'vite';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  plugins: [puterLocalhost('solitaire')],
  base: './',
  build: { outDir: 'dist' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
