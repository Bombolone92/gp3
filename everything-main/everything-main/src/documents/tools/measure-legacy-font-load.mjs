// Local diagnostic only: isolate the target from the playground's default sample.
// Usage: node tools/measure-legacy-font-load.mjs <candidate-module-directory> <output.json> [baseline-module-directory]
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const [directory, output, baselineDirectory] = process.argv.slice(2);
if (!directory || !output) throw new Error('Pass a candidate module directory and output JSON path.');
const candidate = new Map(readdirSync(directory).filter(name => name.endsWith('.js'))
  .map(name => [name, readFileSync(resolve(directory, name), 'utf8')]));
if (!candidate.has('gpos-only-kerning.js')) throw new Error('Missing candidate loader.');
const baseline = baselineDirectory ? new Map(readdirSync(baselineDirectory).filter(name => name.endsWith('.js'))
  .map(name => [name, readFileSync(resolve(baselineDirectory, name), 'utf8')])) : new Map();
if (baselineDirectory && !baseline.has('canvas-text.js')) throw new Error('Missing baseline canvas module.');
const canvas = baseline.get('canvas-text.js') || readFileSync(resolve(root, 'src/engine/canvas-text.js'), 'utf8');
const start = 'export async function loadCanvasFonts(pkg) {';
const end = '  roundedAdvanceFaces.clear();';
for (const anchor of [start, end]) if (canvas.split(anchor).length !== 2) throw new Error('Instrumentation boundary changed.');
function instrument(source) {
  for (const anchor of [start, end]) if (source.split(anchor).length !== 2) throw new Error('Candidate instrumentation boundary changed.');
  return source.replace(start, `${start} const diagnosticStart = performance.now();`)
    .replace(end, `${end}\n  globalThis.diagnosticFontLoads.push(performance.now() - diagnosticStart);`);
}
const measured = { baseline: instrument(canvas), candidate: instrument(candidate.get('canvas-text.js') || canvas) };
const input = readFileSync(resolve(root, 'public/fixtures/kerning-space-pairs.docx'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {
  method: 'Six alternating fresh Edge contexts per mode; isolated HTML with application CSS, no playground sample. One cold validation and five warm validations. Font phases must match validation count.',
  sourceSha256: hash(input), canvasSha256: hash(canvas),
  candidateSha256: Object.fromEntries([...candidate].map(([name, source]) => [name, hash(source)])),
  ...(baselineDirectory ? { baselineSha256: Object.fromEntries([...baseline].map(([name, source]) => [name, hash(source)])) } : {}),
  rows: [],
};
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  report.browser = browser.version();
  for (let round = 0; round < 6; round++) for (const mode of round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
    const context = await browser.newContext({ permissions: ['local-fonts'] });
    try {
      const page = await context.newPage();
      await page.route(/\/src\/engine\/[^/]+\.js(?:\?.*)?$/, route => {
        const name = new URL(route.request().url()).pathname.split('/').at(-1);
        const source = name === 'canvas-text.js' ? measured[mode] : (mode === 'candidate' ? candidate : baseline).get(name);
        return source === undefined ? route.continue() : route.fulfill({ contentType: 'text/javascript', body: source });
      });
      await page.route('**/playground.html', route => route.fulfill({ contentType: 'text/html', body:
        '<!doctype html><html><head><script type="module">import "/src/styles/index.css";</script></head><body></body></html>' }));
      await page.goto('http://127.0.0.1:5173/playground.html');
      const result = await page.evaluate(async encoded => {
        const { DocxPackage } = await import('/src/engine/docx.js');
        const { validateCanvasLayout, measureCanvasText } = await import('/src/engine/canvas-text.js');
        const pkg = await DocxPackage.open(Uint8Array.from(atob(encoded), char => char.charCodeAt(0)));
        globalThis.diagnosticFontLoads = [];
        const validations = [];
        for (let i = 0; i < 6; i++) {
          const started = performance.now(); await validateCanvasLayout(pkg);
          validations.push(performance.now() - started);
        }
        if (globalThis.diagnosticFontLoads.length !== validations.length) throw new Error('Unexpected background font work.');
        const { localFamilyMetadata } = await import('/src/engine/local-fonts.js');
        if (!(await localFamilyMetadata('Rockwell')).length) throw new Error('Requires authorized installed Rockwell.');
        // Qualify the measured rendering after timing: frozen baseline modules
        // must not silently resolve a candidate's private font policy instead.
        const { layoutDocument } = await import('/src/engine/layout.js');
        const { pageGeometry } = await import('/src/engine/page-settings.js');
        const ctx = document.createElement('canvas').getContext('2d');
        const layout = layoutDocument(pkg.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(pkg.pageSettings));
        return { validations, fontTimings: globalThis.diagnosticFontLoads,
          firstLineOriginPt: layout.lines[0].fragments[0].x * .75, lineCount: layout.lines.length, readOnly: !!pkg.readOnly };
      }, input.toString('base64'));
      report.rows.push({ round, mode, ...result });
      writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(report.rows.at(-1)));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
