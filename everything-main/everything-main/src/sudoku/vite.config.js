import { defineConfig } from 'vite';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  plugins: [puterLocalhost('sudoku')],
  // Relative asset URLs so a build can be dropped at any path — including a
  // Puter app subdirectory — without a rebuild.
  base: './',
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
