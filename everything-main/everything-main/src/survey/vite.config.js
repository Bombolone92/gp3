import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import puterLocalhost from '../../dev/puter-localhost.mjs';

// Two pages: the survey builder (index.html) and the page respondents open
// from a shared link (r/index.html). The respondent page loads no SDK and none
// of the builder, so a survey link opens fast on any phone.
export default defineConfig({
  plugins: [puterLocalhost('survey')],
  base: './',
  build: {
    target: 'es2022',
    cssTarget: 'safari15',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        respond: fileURLToPath(new URL('./r/index.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5263,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
  },
});
