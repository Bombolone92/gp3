import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { publicContentPlugin } from './site/plugin.js';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  appType: 'mpa',
  plugins: [puterLocalhost('cap-table'), {
    name: 'static-public-landing',
    transformIndexHtml(html) {
      // One source for the crawlable document and the mock/auth fallback.
      return html.replace('<!-- site-analytics -->', () => readFileSync(new URL('./site/analytics.html', import.meta.url), 'utf8'))
        .replace('<!-- public-landing -->', () =>
        `<div id="landing-top" class="landing">${readFileSync(new URL('./src/views/landing.html', import.meta.url), 'utf8')}</div>`);
    },
  }, publicContentPlugin()],
  base: './',
  build: {
    target: 'es2022',
    cssTarget: 'safari15',
  },
  server: {
    port: 5174,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
