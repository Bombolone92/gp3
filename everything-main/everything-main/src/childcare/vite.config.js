import { defineConfig } from 'vite';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  plugins: [puterLocalhost('childcare')],
  base: './',
  build: { target: 'es2022', cssTarget: 'safari15' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
