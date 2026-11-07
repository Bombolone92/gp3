import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';

/**
 * Bundles the review worker into one plain script for Puter's worker
 * runtime, which provides `router` and `me` as globals. The owner's app
 * deploys it to their own account (src/review/api.js). The build id is a
 * hash of the bundled code, written in the first line, so the app can tell
 * a deployed worker is out of date; the build time lets it only ever move
 * a worker forward.
 *
 *   npm run build:worker  ->  public/worker/video-studio-review-worker.js
 */
const BUILD = '__VIDEO_REVIEW_WORKER_BUILD__';
const BUILT_AT = '__VIDEO_REVIEW_WORKER_BUILT_AT__';
const builtAt = Date.now();

export default defineConfig({
  publicDir: false,
  plugins: [
    {
      name: 'review-worker-header',
      generateBundle(_options, bundle) {
        for (const out of Object.values(bundle)) {
          if (out.type !== 'chunk' || !out.isEntry) continue;
          const build = createHash('sha256').update(out.code).digest('hex').slice(0, 16);
          // The minifier may quote the placeholder either way.
          let code = out.code.replaceAll(BUILD, build);
          for (const q of ['"', "'", '`']) code = code.replaceAll(`${q}${BUILT_AT}${q}`, String(builtAt));
          if (code.includes(BUILT_AT)) this.error('The worker build time could not be filled in.');
          out.code = `/* video-studio-review-worker build=${build} at=${builtAt} */\n${code}`;
        }
      },
    },
  ],
  define: {
    __WORKER_BUILD__: JSON.stringify(BUILD),
    __WORKER_BUILT_AT__: JSON.stringify(BUILT_AT),
  },
  build: {
    target: 'es2022',
    outDir: 'public/worker',
    emptyOutDir: true,
    lib: {
      entry: 'worker/index.js',
      name: 'VideoStudioReviewWorker',
      formats: ['iife'],
      fileName: () => 'video-studio-review-worker.js',
    },
  },
});
