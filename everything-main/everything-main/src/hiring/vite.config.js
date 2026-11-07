import { defineConfig } from 'vite';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  plugins: [puterLocalhost('hiring')],
  base: './',
  build: {
    target: 'es2022',
  },
  server: {
    port: 5173,
  },
});
