import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import puterLocalhost from '../../dev/puter-localhost.mjs';

/**
 * Emit sw.js into the build with the list of everything to precache and a
 * version derived from the assets, so a new build is a new cache and the
 * app can offer to reload. The worker script itself lives in src/sw.js.
 */
function serviceWorkerPlugin() {
  return {
    name: 'teamchat-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'sw.js').map((f) => `./${f}`);
      const publicAssets = ['manifest.webmanifest', 'favicon.ico', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
      assets.push('./', './index.html', ...publicAssets.map((name) => `./${name}`));
      const hash = createHash('sha256');
      for (const [name, item] of Object.entries(bundle)) hash.update(name).update(item.type === 'chunk' ? item.code : String(item.source));
      // Public files bypass the bundle; include their contents so icon-only
      // updates also replace the offline shell's cached artwork.
      for (const name of publicAssets) hash.update(name).update(readFileSync(`public/${name}`));
      const version = hash.digest('hex').slice(0, 12);
      const source = readFileSync('src/sw.js', 'utf8')
        .replaceAll('__SW_VERSION__', JSON.stringify(version))
        .replaceAll('__SW_ASSETS__', JSON.stringify([...new Set(assets)]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [puterLocalhost('teamchat'), serviceWorkerPlugin()],
  build: {
    target: 'es2022',
    cssTarget: 'safari15',
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
