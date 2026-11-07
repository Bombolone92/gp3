// Read-only audit in the browser's native XML parser. A parse pass is not a
// rendering/editing certification. Keep source documents and artwork local.
// Usage: node tools/audit-corpus-imports.mjs ROOT_OR_DOCX OUTPUT_JSON [import|open|paint|fonts]
// Requires an existing playground server; never starts or changes its host.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const [input, output, mode = 'import'] = process.argv.slice(2);
if (!input || !output || !['import', 'open', 'paint', 'fonts'].includes(mode)) {
  throw new Error('Usage: node tools/audit-corpus-imports.mjs ROOT_OR_DOCX OUTPUT_JSON [import|open|paint|fonts]');
}
const root = resolve(input), directory = statSync(root).isDirectory();
// Audit sources and previously captured evidence must remain immutable. After
// this check, checkpoint writes update only the report owned by this invocation.
if (!/\.json$/i.test(output) || existsSync(resolve(output))) {
  throw new Error('Use a fresh JSON report path; sources and existing evidence are never overwritten.');
}
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => {
  const file = resolve(path, entry.name);
  return entry.isDirectory() ? walk(file) : /\.docx$/i.test(entry.name) && !entry.name.startsWith('~$') ? [file] : [];
});
const files = (directory ? walk(root) : [root]).sort();
if (!files.length) throw new Error('No DOCX source files found.');
const url = process.env.DOCX_AUDIT_URL || 'http://127.0.0.1:5173/playground.html';
// Audit-only isolation: keep package font parts opaque when their programs are
// outside the review's authorized scope. Never change the production font path.
// Opt into program review only when those font resources are authorized.
const opaqueFonts = process.env.DOCX_AUDIT_OPAQUE_FONTS !== '0';
const report = { mode, url, embeddedFontPrograms: opaqueFonts ? 'opaque; decoding/registration disabled in this audit' : 'production behavior', startedAt: new Date().toISOString(), complete: false,
  scope: mode === 'paint' ? 'Best-effort display preparation and all-page canvas painting/readback; not native visual fidelity, editing or export verification.' :
    mode === 'fonts' ? 'Current main/page-story layout font selection and cached family availability, with embedded font programs opaque by default. Excludes drawing-scene text, intrinsic picture text, per-glyph fallback and genuine style-face verification; not native fidelity or template certification.' :
    mode === 'import' ? 'Strict XML import only; no font, layout, decode or editing verification.' :
    'Best-effort display preparation; not visual fidelity, editing or export verification.', rows: [] };
mkdirSync(dirname(resolve(output)), { recursive: true });
// Claim the new report exclusively; concurrent invocations cannot replace it.
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
try {
  const page = await browser.newPage();
  if (opaqueFonts) await page.route(/\/src\/engine\/embedded-fonts\.js(?:\?.*)?$/, route => route.fulfill({
    contentType: 'text/javascript',
    body: 'export const decodeEmbeddedFont=()=>null,isEmbeddedFont=()=>false,embeddedPreviewOnly=()=>false,embeddedFontSources=()=>null,documentEmbeddedFonts=()=>new Map();',
  }));
  await page.goto(url, { timeout: 120000 });
  if (opaqueFonts) {
    await page.evaluate(async () => {
      const guard = await import('/src/engine/embedded-fonts.js');
      if (guard.decodeEmbeddedFont.toString() !== '()=>null' || guard.embeddedFontSources.toString() !== '()=>null' || guard.documentEmbeddedFonts.toString() !== '()=>new Map()') throw new Error('Opaque font audit guard was not installed.');
    });
    report.opaqueFontGuardVerified = true;
  }
  for (const file of files) {
    const bytes = readFileSync(file);
    const started = performance.now();
    const result = await page.evaluate(async ({ encoded, mode }) => {
      try {
        const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
        let pkg, images;
        if (mode !== 'import') {
          const { openCanvasDocument } = await import('/src/engine/open-document.js');
          ({ pkg, images } = await openCanvasDocument(bytes));
        } else {
          const { DocxPackage } = await import('/src/engine/docx.js');
          pkg = await DocxPackage.open(bytes);
        }
        const result = { success: true, paragraphs: pkg.paragraphs.length, tables: pkg.tables.length,
          assets: Object.keys(pkg.assets).length, ...(images ? { decodedImages: images.size } : {}),
          ...(images ? { missingPictureFonts: pkg.missingPictureFonts || [] } : {}),
          readOnly: Boolean(pkg.readOnly), issues: pkg.previewIssues || [] };
        if (mode === 'paint' || mode === 'fonts') {
          const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
          const host = document.createElement('div'), errors = [];
          let editor;
          document.body.append(host);
          try {
            editor = new CanvasEditor(host, { ...pkg, images, onError: error => errors.push(error.message) });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            if (mode === 'fonts') {
              const { recordLayoutFontSelection } = await import('/tools/record-layout-font-selection.js');
              result.fontChoices = recordLayoutFontSelection(editor, pkg.styles?.fontAlternatives);
              result.pageCount = editor.layout.pageCount;
            } else {
              editor.paint();
              result.pages = [];
              for (const canvas of editor.canvases) {
                const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                const digest = await crypto.subtle.digest('SHA-256', pixels);
                result.pages.push({ width: canvas.width, height: canvas.height,
                  rgbaSha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('') });
              }
            }
            result.storyIssues = editor.storyLayout.unsupported;
            result.paintErrors = errors;
            result.success = errors.length === 0 && (mode === 'fonts' ? result.pageCount > 0 : result.pages.length > 0);
          } finally {
            if (editor) editor.destroy();
            else { for (const image of images.values()) image.close?.(); images.clear(); }
            host.remove();
          }
        } else if (images) {
          for (const image of images.values()) image.close?.();
          images.clear();
        }
        return result;
      } catch (error) { return { success: false, error: error.message }; }
    }, { encoded: bytes.toString('base64'), mode });
    report.rows.push({ file: directory ? relative(root, file).replaceAll('\\', '/') : file,
      sha256: createHash('sha256').update(bytes).digest('hex'), elapsedMs: Math.round(performance.now() - started), ...result });
    save();
    console.log(`${report.rows.length}/${files.length}: ${result.success ? 'ok' : result.error || result.paintErrors?.join('; ') || 'No page canvases'} — ${file}`);
  }
  report.complete = true;
  report.finishedAt = new Date().toISOString();
  save();
  process.exitCode = Number(report.rows.some(row => !row.success));
} finally { await browser.close(); }
