// Read-only diagnostic. Exit 1 means the structured recovery requirement fails.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const folder = 'tests/fixtures/relative-autofit-recovery/';
const sources = ['unsupported', 'matched'].map(name => {
  const bytes = readFileSync(folder + name + '.docx');
  return { name, bytes: [...bytes], sha256: createHash('sha256').update(bytes).digest('hex') };
});
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/playground.html');
  const results = await page.evaluate(async sources => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { validateCanvasLayout } = await import('/src/engine/canvas-text.js');
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const out = [];
    for (const { name, bytes, sha256 } of sources) {
      const input = new Uint8Array(bytes);
      const raw = await DocxPackage.open(input, { bestEffort: true });
      const before = JSON.stringify(raw.assets);
      let error;
      try { await validateCanvasLayout(raw); } catch (e) { error = e.message; }
      const { pkg, images } = await openCanvasDocument(input);

      out.push({ name, sha256, validationError: error || null,
        assetsChangedDuringValidation: before !== JSON.stringify(raw.assets),
        fittedAssetsAfterValidation: Object.values(raw.assets).filter(a => a.fittedFrame).length,
        readOnly: !!pkg.readOnly, issues: pkg.previewIssues || [],
        decodedImages: images.size, tables: pkg.tables.length,
        hasPageStories: !!pkg.pageStories,
        sourcePartsPreserved: JSON.stringify(pkg.parts) === JSON.stringify(raw.parts),
      });
    }
    return out;
  }, sources);
  const [actual, control] = results;
  if (control.validationError || control.readOnly || control.decodedImages !== 4
      || control.tables !== 1 || !control.hasPageStories || !control.sourcePartsPreserved) {
    throw new Error(`Matched control is not healthy: ${JSON.stringify(control)}`);
  }
  const recovered = actual.decodedImages === control.decodedImages && actual.tables === control.tables
    && actual.hasPageStories === control.hasPageStories && actual.sourcePartsPreserved;
  console.log(JSON.stringify({ recovered, results }, null, 2));
  if (!recovered) process.exitCode = 1;
} finally { await browser.close(); }
