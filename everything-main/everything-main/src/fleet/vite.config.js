import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puterLocalhost from '../../dev/puter-localhost.mjs';

/**
 * Writes this build's asset list and a build id into the service worker, so
 * it stores every screen at install (the app opens offline after a single
 * visit) and each deploy gets a fresh cache.
 */
export function swPrecache() {
  let outDir;
  return {
    name: 'fleet-sw-precache',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const assets = readdirSync(join(outDir, 'assets'))
        .sort()
        .map((f) => `./assets/${f}`);
      const build = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12);
      const file = join(outDir, 'sw.js');
      const src = readFileSync(file, 'utf8');
      const out = src.replace("const BUILD = 'dev';", `const BUILD = '${build}';`).replace('const ASSETS = [];', `const ASSETS = ${JSON.stringify(assets)};`);
      if (!out.includes(build) || out.includes('const ASSETS = [];')) throw new Error('sw.js: build placeholders not found');
      writeFileSync(file, out);
    },
  };
}

export default defineConfig({
  plugins: [puterLocalhost('fleet'), swPrecache()],
  base: './',
  build: { target: 'es2022', cssTarget: 'safari15' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
