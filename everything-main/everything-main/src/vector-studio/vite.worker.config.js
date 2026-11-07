import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';

// The collaboration worker bundle. Its build id is a hash of the bundled
// code, so any change to a module it imports makes owners' deployed
// workers update; the build time is filled in after hashing.
const PLACEHOLDER = '__VECTOR_STUDIO_WORKER_BUILD__';
const TIME_PLACEHOLDER = '__VECTOR_STUDIO_WORKER_BUILT_AT__';
const builtAt = Date.now();

export default defineConfig({
  publicDir: false,
  plugins: [
    {
      name: 'vector-studio-worker-metadata',
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== 'chunk' || !output.isEntry) continue;
          const build = createHash('sha256').update(output.code).digest('hex').slice(0, 16);
          const code = output.code.replaceAll(PLACEHOLDER, build).replace(new RegExp(`(["'\`])${TIME_PLACEHOLDER}\\1`, 'g'), String(builtAt));
          if (code.includes(TIME_PLACEHOLDER)) this.error('The worker build time could not be filled in.');
          output.code = `/* vector-studio-worker build=${build} at=${builtAt} */\n${code}`;
        }
      },
    },
  ],
  define: {
    __WORKER_BUILD__: JSON.stringify(PLACEHOLDER),
    __WORKER_BUILT_AT__: JSON.stringify(TIME_PLACEHOLDER),
  },
  build: {
    target: 'es2022',
    outDir: 'public/worker',
    emptyOutDir: true,
    lib: {
      entry: 'worker/index.js',
      name: 'VectorStudioWorker',
      formats: ['iife'],
      fileName: () => 'vector-studio-worker.js',
    },
  },
});
