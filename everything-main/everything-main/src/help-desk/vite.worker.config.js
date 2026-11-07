import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Bundles the Puter worker into one plain script. The worker runtime provides
 * `router` and `me` as globals, so the output is an IIFE that uses them
 * without importing anything.
 *
 * The bundle is written to public/worker/ and shipped as a static file. When
 * a help desk owner turns on team access, their browser writes it to their
 * Puter drive and deploys it from there (see src/client/deploy.js). The build
 * id is a hash of the sources, so the app can tell when a deployed worker is
 * out of date and quietly redeploy it.
 */
function sourceHash() {
  const h = createHash('sha256');
  for (const dir of ['worker', 'src/server', 'src/shared']) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
      h.update(`${dir}/${f}\n`);
      h.update(readFileSync(join(dir, f)));
    }
  }
  return h.digest('hex').slice(0, 12);
}

const build = sourceHash();
const builtAt = Date.now();

export default defineConfig({
  publicDir: false,
  define: {
    __WORKER_BUILD__: JSON.stringify(build),
    __WORKER_BUILT_AT__: JSON.stringify(builtAt),
  },
  build: {
    target: 'es2022',
    outDir: 'public/worker',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: 'worker/index.js',
      formats: ['iife'],
      name: 'helpDeskWorker',
      fileName: () => 'help-desk-worker.js',
    },
    rollupOptions: {
      output: { banner: `/* help-desk-worker build=${build} at=${builtAt} */` },
    },
  },
});
