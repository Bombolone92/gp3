import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vite';
import puterLocalhost from '../../dev/puter-localhost.mjs';

/**
 * Emit the service worker with its precache list and a version baked in.
 *
 * The list has to be generated: the built asset names are hashed, so a
 * hand-written service worker cannot know them. Baking them in also means
 * sw.js changes bytes on every build that changes an asset, which is what
 * makes the browser notice an update at all — a static service worker
 * would keep serving the old bundle forever.
 */
function serviceWorker() {
  return {
    name: 'assetdesk-service-worker',
    apply: 'build',
    async generateBundle(_options, bundle) {
      const built = Object.keys(bundle)
        .filter((name) => !name.endsWith('.map'))
        .map((name) => `./${name}`);
      // The shell, the built assets, and the files the manifest points at
      // (copied from public/, so they are not in the bundle).
      const precache = [
        './',
        './index.html',
        './manifest.json',
        './icons/icon-192.png',
        './icons/icon-512.png',
        './icons/icon-maskable-512.png',
        './icons/apple-touch-icon.png',
        // The tab icons index.html links to: without them an offline open
        // showed the browser's blank placeholder in the tab.
        './icons/favicon-32.png',
        './icons/favicon-16.png',
        ...built,
      ];
      const template = await readFile(new URL('./src/sw.js', import.meta.url), 'utf8');
      const version = createHash('sha256').update(precache.join('|')).digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__PRECACHE__', JSON.stringify(precache, null, 2))
          .replaceAll('__VERSION__', version),
      });
    },
  };
}

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
  },
  plugins: [puterLocalhost('assets'), serviceWorker()],
  test: {
    environment: 'node',
  },
});
