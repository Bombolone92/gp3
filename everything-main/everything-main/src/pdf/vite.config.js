import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puterLocalhost from '../../dev/puter-localhost.mjs';
let workerDevelopmentUrl;
// On-device OCR (src/ocr-engine.js) loads tesseract.js's worker, its WebAssembly core and the
// English model from ocr/ beside the app, never from a CDN. Only the LSTM cores are needed (the
// engine runs LSTM-only); the worker picks one by the browser's SIMD support. The model is
// tessdata_best_int (integer-quantized "best"), a good balance of size and accuracy.
const ocrAssets = {
  'worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'core/tesseract-core-relaxedsimd-lstm.wasm.js':
    'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'core/tesseract-core-simd-lstm.wasm.js':
    'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'core/tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'lang/eng.traineddata.gz':
    'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  'LICENSE-tesseract.js.md': 'node_modules/tesseract.js/LICENSE.md',
  'LICENSE-tesseract.js-core.txt': 'node_modules/tesseract.js-core/LICENSE',
};
export default defineConfig({
  base: './',
  plugins: [
    puterLocalhost('pdf'),
    {
      // Keep the worker's module export: PDF.js imports WorkerMessageHandler on the main
      // thread when native workers are unavailable. Vite's ?worker bundles drop exports.
      name: 'pdf-worker-entry',
      configResolved(config) {
        workerDevelopmentUrl = `${config.base}src/pdf-worker.js`;
      },
      resolveId(id) {
        if (id === 'virtual:pdf-worker-url') return '\0pdf-worker-url';
      },
      load(id) {
        if (id !== '\0pdf-worker-url') return;
        if (this.environment.mode === 'dev')
          return `export default ${JSON.stringify(workerDevelopmentUrl)}`;
        const ref = this.emitFile({
          type: 'chunk',
          id: fileURLToPath(new URL('./src/pdf-worker.js', import.meta.url)),
          preserveSignature: 'strict',
        });
        return `export default import.meta.ROLLUP_FILE_URL_${ref}`;
      },
    },
    {
      name: 'pdf-assets',
      closeBundle() {
        for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
          mkdirSync(`dist/pdfjs/${dir}`, { recursive: true });
          cpSync(`node_modules/pdfjs-dist/${dir}`, `dist/pdfjs/${dir}`, { recursive: true });
        }
        // Four of the standard fonts are Liberation Sans 1.07.4, licensed under the GPL v2 with
        // a font exception, so the build ships their corresponding source and license beside
        // them (see vendor/liberation-fonts and docs/ENGINE_AND_LICENSES.md).
        cpSync('vendor/liberation-fonts', 'dist/pdfjs/standard_fonts/liberation-source', {
          recursive: true,
        });
      },
      configureServer(server) {
        server.middlewares.use('/pdfjs', async (req, res, next) => {
          const { createReadStream, existsSync } = await import('node:fs');
          const { resolve, sep } = await import('node:path');
          const root = resolve('node_modules/pdfjs-dist');
          const path = resolve(root, '.' + (req.url || '').split('?')[0]);
          if (!path.startsWith(root + sep) || !existsSync(path)) return next();
          if (path.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
          createReadStream(path).on('error', next).pipe(res);
        });
      },
    },
    {
      name: 'ocr-assets',
      closeBundle() {
        for (const [to, from] of Object.entries(ocrAssets)) {
          mkdirSync(dirname(`dist/ocr/${to}`), { recursive: true });
          cpSync(from, `dist/ocr/${to}`);
        }
      },
      configureServer(server) {
        server.middlewares.use('/ocr', async (req, res, next) => {
          const { createReadStream } = await import('node:fs');
          const from = ocrAssets[decodeURIComponent((req.url || '').split('?')[0]).slice(1)];
          if (!from) return next();
          // The model stays gzip-compressed on the wire; tesseract.js inflates it itself.
          const type = from.endsWith('.gz')
            ? 'application/octet-stream'
            : from.endsWith('.js')
              ? 'text/javascript'
              : 'text/plain';
          res.setHeader('Content-Type', type);
          createReadStream(from).on('error', next).pipe(res);
        });
      },
    },
  ],
  // Tests that render through PDF.js need longer than the default five seconds on a busy machine.
  test: { include: ['tests/**/*.test.js'], testTimeout: 20000 },
});
