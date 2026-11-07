// Production build with chunk statistics: every chunk's minified and gzip
// size, and the largest modules of the startup (entry) chunk.
// Usage: node scripts/perf-bundle.mjs [top modules, default 30]
import { build } from "vite";
import { gzipSync } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const top = Number(process.argv[2] ?? 30);
const outDir = await mkdtemp(path.join(tmpdir(), "photo-studio-bundle-"));
const chunks = [];
await build({
  logLevel: "error",
  build: { outDir, emptyOutDir: true },
  plugins: [
    {
      name: "bundle-stats",
      generateBundle(_options, bundle) {
        for (const [file, c] of Object.entries(bundle)) {
          const code = c.type === "chunk" ? c.code : c.source;
          const bytes = typeof code === "string" ? Buffer.from(code) : Buffer.from(code);
          chunks.push({
            file,
            size: bytes.length,
            gzip: /\.(js|css|wasm)$/.test(file) ? gzipSync(bytes, { level: 9 }).length : 0,
            entry: c.type === "chunk" && c.isEntry,
            modules: c.type === "chunk" ? Object.entries(c.modules).map(([id, m]) => [path.relative(process.cwd(), id), m.renderedLength]) : [],
          });
        }
      },
    },
  ],
});
await rm(outDir, { recursive: true, force: true });
// kB as in the vite build report (1000 bytes).
const kb = (n) => (n / 1000).toFixed(1).padStart(8) + " kB";
chunks.sort((a, b) => b.size - a.size);
for (const c of chunks.filter((c) => /\.(js|css|wasm)$/.test(c.file)))
  console.log(`${kb(c.size)} ${kb(c.gzip)} gz  ${c.file}${c.entry ? "  (startup)" : ""}`);
const js = chunks.filter((c) => c.file.endsWith(".js"));
console.log(`\n${js.length} JS chunks, ${kb(js.reduce((n, c) => n + c.size, 0)).trim()} in all`);
const entry = chunks.find((c) => c.entry);
if (entry) {
  console.log(`\nLargest modules in the startup chunk (before minification):`);
  for (const [id, n] of entry.modules.sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${kb(n)}  ${id}`);
}
