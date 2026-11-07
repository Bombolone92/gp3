import { defineConfig } from 'vite';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  plugins: [puterLocalhost('cad')],
  base: './',
  build: { target: 'es2022', cssTarget: 'safari15' },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
