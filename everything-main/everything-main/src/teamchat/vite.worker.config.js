import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Bundles the Puter Serverless Worker into one plain script. The worker
 * runtime provides `router` and `me` as globals, so the output is an IIFE
 * that references them without importing anything.
 *
 * The bundle lands in public/worker/ so the app ships it as a static asset:
 * each workspace owner's browser deploys it to their own Puter account (see
 * src/lib/deploy.js). A build id derived from the worker's source files is
 * compiled in and written in the first line, which is how the app tells a
 * deployed worker is out of date without a version to bump by hand.
 *
 *   npm run build:worker  ->  public/worker/teamchat-worker.js
 */

function sourceHash() {
  const h = createHash('sha256');
  for (const dir of ['worker', 'src/shared']) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
      h.update(`${dir}/${f}\n`);
      h.update(readFileSync(join(dir, f)));
    }
  }
  return h.digest('hex').slice(0, 12);
}

const build = sourceHash();
// When this bundle was built. Two builds differ by their hash alone, which
// says nothing about which is newer; the app rewrites an owner's worker only
// forward (see lib/deploy.js), so an app served from an older cache never
// puts an older worker back over the one another device brought up to date.
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
      name: 'teamchatWorker',
      fileName: () => 'teamchat-worker.js',
    },
    rollupOptions: {
      output: {
        banner: `/* teamchat-worker build=${build} at=${builtAt} */`,
      },
    },
  },
});
