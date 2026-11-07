import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import puterLocalhost from "../../dev/puter-localhost.mjs";

// Features opened on demand (the Miro migration, the administration console,
// the PowerPoint, SVG and PDF writers, and the PDF reader) load as their own
// files. Everything else stays in the main file, which the app and its tests
// load as a single module. Anything that imports pdf-lib must be listed here
// too: in the main file it makes the main file import the PDF writer at
// startup, and the writer, which needs helpers from the main file, then runs
// before them and stops the app from loading.
const LAZY =
  /\/src\/(migration\/|organization\/admin-ui\.js|export-svg\.js|export-pptx\.js|export-pdf-vector\.js|pdf-unicode-text\.js)|\/node_modules\/(pdfjs-dist|pdf-lib|@pdf-lib|pako)\//;

// pdf.js decodes JBIG2, CCITT and JPEG 2000 images (common in scanned PDFs)
// and ICC colors with WebAssembly modules it fetches by name from one folder,
// with plain JavaScript fallbacks for browsers without WebAssembly. They are
// served from the application's own host under a folder named after the
// pdf.js version, which src/content/pdf-loader.js passes to pdf.js, along
// with the decoders' license texts.
const pdfjsRoot = dirname(
  createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
);
const pdfjsVersion = JSON.parse(
  readFileSync(join(pdfjsRoot, "package.json"), "utf8"),
).version;
const PDF_WASM_DIR = `assets/pdfjs-${pdfjsVersion}/`;
const PDF_WASM_FILES = [
  "jbig2.wasm",
  "openjpeg.wasm",
  "qcms_bg.wasm",
  "jbig2_nowasm_fallback.js",
  "openjpeg_nowasm_fallback.js",
  "LICENSE_JBIG2",
  "LICENSE_OPENJPEG",
  "LICENSE_QCMS",
  "LICENSE_PDFJS_JBIG2",
  "LICENSE_PDFJS_OPENJPEG",
  "LICENSE_PDFJS_QCMS",
];
const pdfWasm = (name) => readFileSync(join(pdfjsRoot, "wasm", name));
const TYPES = { wasm: "application/wasm", js: "text/javascript" };
const typeOf = (name) => TYPES[name.split(".").pop()] ?? "text/plain";

export default defineConfig({
  // The dependency scan reads only the app's page. Without this, Vite scans
  // every HTML file under the project, including the saved audit builds in
  // tmp/, which fails and disables dependency pre-bundling for the dev server.
  optimizeDeps: { entries: ["index.html"] },
  plugins: [
    puterLocalhost("whiteboard"),
    {
      name: "whiteboard-pdfjs-wasm",
      configureServer(server) {
        const prefix = server.config.base + PDF_WASM_DIR;
        server.middlewares.use((req, res, next) => {
          const path = req.url?.split("?")[0] ?? "";
          const name = path.startsWith(prefix) && path.slice(prefix.length);
          if (!PDF_WASM_FILES.includes(name)) return next();
          res.setHeader("Content-Type", typeOf(name));
          res.end(pdfWasm(name));
        });
      },
      generateBundle() {
        for (const name of PDF_WASM_FILES)
          this.emitFile({
            type: "asset",
            fileName: PDF_WASM_DIR + name,
            source: pdfWasm(name),
          });
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          LAZY.test(id)
            ? /\/node_modules\/(pdf-lib|@pdf-lib|pako)\//.test(id)
              ? "pdf-writer"
              : undefined
            : "index",
      },
    },
  },
});
