// Diagnostic route only: removing the horizontal-alignment guard is a hypothesis,
// never a production patch. Compare complete row identities and page coordinates.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { join } from 'node:path';
const [nativePath, output, source = 'tests/fixtures/aligned-multipage-floating/control.docx', manifestPath = 'tests/fixtures/aligned-multipage-floating/cases.json', baselineDirectory] = process.argv.slice(2);
assert(nativePath && output && !existsSync(output), 'Provide a native reference and fresh output');
const bytes = readFileSync(source), digest = b => createHash('sha256').update(b).digest('hex');
const manifest = JSON.parse(readFileSync(manifestPath));
const native = JSON.parse(readFileSync(nativePath));
assert.equal(digest(bytes), manifest.sourceSha256);
assert.equal(native.sourceSha256, manifest.sourceSha256);
assert.equal(native.sourceUnchanged, true);
assert.equal(native.savedStateUnchanged, true);
const engineDirectory = baselineDirectory || 'src/engine';
const original = readFileSync(join(engineDirectory, 'floating-table-flow.js'), 'utf8');
const tableReader = readFileSync('src/engine/docx-tables.js');
const needle = ' || position.tblpXSpec || position.tblpYSpec';
assert.equal(original.split(needle).length, 2, 'Provide a guarded baseline engine directory for this historical diagnostic; current support uses verify-aligned-floating.mjs');
const candidate = original.replace(needle, ' || position.tblpYSpec');
const layoutOriginal = readFileSync(join(engineDirectory, 'layout.js'), 'utf8');
const layoutNeedle = 'blocks: result, page, anchorId: anchor.id,';
assert.equal(layoutOriginal.split(layoutNeedle).length, 2);
const storedAlignmentWidths = layoutOriginal.includes('floatingAlignmentWidths = {}');
const layoutCandidate = layoutOriginal.replace(layoutNeedle, `${layoutNeedle}
        width: ${storedAlignmentWidths ? 'floatingAlignmentWidths[block.table.id]' : 'tableWidths[block.table.id].reduce((sum, value) => sum + value, 0)'},
        measuredPageIndex: wrapHints?.paragraphs.get(anchor.id)?.[0]?.page || 0,`)
  .replace('section.pageOffset = offset;', 'section.pageOffset = offset; physical = { ...physical, floatingPageOffset: offset };');
const paginationOriginal = readFileSync(join(engineDirectory, 'pagination.js'), 'utf8');
const paginationNeedle = 'paginateFloatingFlow(floating, offsetPage(page, pageIndex),';
assert.equal(paginationOriginal.split(paginationNeedle).length, 2);
const paginationCandidate = paginationOriginal.replace(paginationNeedle,
  'paginateFloatingFlow(floating, { ...offsetPage(page, pageIndex), floatingPhysicalPageIndex: (page.floatingPageOffset || 0) + pageIndex },');
const pageCandidate = candidate.replace("import { floatingTableY }", "import { floatingTableX, floatingTableY }")
  .replace('const dx = floatingTableInset', 'let dx = floatingTableInset')
  .replace('const flowPage = offsetPage(page, leading);', `const flowPage = offsetPage(page, leading);
  if (position.tblpXSpec) dx += floatingTableX(position, flowPage, floating.alignmentWidth ?? floating.width, (page.floatingPhysicalPageIndex || 0) + leading)
    - floatingTableX(position, floating.page, floating.alignmentWidth ?? floating.width, floating.measuredPageIndex);`);
const writingCandidate = pageCandidate.replace('const translated = !modern', `if (!modern && position.tblpXSpec && floating.alignmentWidth === undefined) {
    const first = probe.cells.find(c => c.tableId === floating.table.id);
    const row = probe.cells.filter(c => c.tableId === floating.table.id && c.rowId === first.rowId && c.page === first.page);
    const last = row.at(-1), padding = (first.margins.left + last.margins.right) / 15;
    dx += floatingTableX(position, flowPage, floating.width - padding, (page.floatingPhysicalPageIndex || 0) + leading)
      - floatingTableX(position, flowPage, floating.width, (page.floatingPhysicalPageIndex || 0) + leading);
  }
  const translated = !modern`);
const widthVariable = storedAlignmentWidths ? 'floatingWidth' : 'width';
const widthNeedle = `floatingTableX(table.floating, page, ${widthVariable}, wrapHints?.paragraphs.get(floatingAnchor?.id)?.[0]?.page || 0)`;
assert.equal(layoutOriginal.split(widthNeedle).length, 2);
const shortWritingLayout = widthVariable === 'floatingWidth' ? layoutCandidate : layoutCandidate.replace(widthNeedle,
  'floatingTableX(table.floating, page, width - ((page.compatibilityMode ?? 12) < 15 ? (block.rows[0].cells[0].margins.left + block.rows[0].cells.at(-1).margins.right) / 15 : 0), wrapHints?.paragraphs.get(floatingAnchor?.id)?.[0]?.page || 0)');
const seededLayoutCandidate = layoutCandidate.replace('floatingPageOffset: offset',
  'floatingPageOffset: offset, floatingPageSideOffset: (pageStories?.sections[0]?.pageNumbering?.start ?? 1) - 1');
const seededCandidate = writingCandidate.replaceAll('(page.floatingPhysicalPageIndex || 0) + leading',
  '(page.floatingPhysicalPageIndex || 0) + leading + (page.floatingPageSideOffset || 0)');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
try {
  for (const mode of ['baseline', 'horizontal-guard-only', 'first-fragment-page', 'writing-width', 'initial-page-side']) {
    const pageAware = ['first-fragment-page', 'writing-width', 'initial-page-side'].includes(mode);
    const context = await browser.newContext(), page = await context.newPage();
    let routed = 0, layoutRouted = 0, paginationRouted = 0;
    const routedUrls = [];
    if (mode !== 'baseline' || baselineDirectory) await page.route(/\/src\/engine\/floating-table-flow\.js(?:\?.*)?$/, route => {
      routed++; routedUrls.push(route.request().url()); return route.fulfill({ contentType: 'text/javascript', body: `globalThis.__alignedFlowExecuted = (globalThis.__alignedFlowExecuted || 0) + 1;\n${mode === 'baseline' ? original : mode === 'initial-page-side' ? seededCandidate : mode === 'writing-width' ? writingCandidate : pageAware ? pageCandidate : candidate}` });
    });
    if (pageAware || baselineDirectory) await page.route(/\/src\/engine\/layout\.js(?:\?.*)?$/, route => {
      layoutRouted++; return route.fulfill({ contentType: 'text/javascript', body: `globalThis.__alignedLayoutExecuted = (globalThis.__alignedLayoutExecuted || 0) + 1;\n${!pageAware ? layoutOriginal : mode === 'initial-page-side' ? seededLayoutCandidate : mode === 'writing-width' && manifest.rowsPerTable === 3 ? shortWritingLayout : layoutCandidate}` });
    });
    if (pageAware || baselineDirectory) await page.route(/\/src\/engine\/pagination\.js(?:\?.*)?$/, route => {
      paginationRouted++; return route.fulfill({ contentType: 'text/javascript', body: `globalThis.__alignedPaginationExecuted = (globalThis.__alignedPaginationExecuted || 0) + 1;\n${pageAware ? paginationCandidate : paginationOriginal}` });
    });
    await page.goto('http://127.0.0.1:5173/playground.html');
    const result = await page.evaluate(async bytes => {
      const { openCanvasDocument } = await import('/src/engine/open-document.js');
      const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
      const { layoutDocument } = await import('/src/engine/layout.js');
      const { pageGeometry } = await import('/src/engine/page-settings.js');
      const { pkg, images } = await openCanvasDocument(Uint8Array.from(bytes));
      let strictError;
      try { layoutDocument(pkg.paragraphs, text => ({ width: text.length * 6, ascent: 12, descent: 4 }), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables); }
      catch (error) { strictError = error.message; }
      const host = document.createElement('div'); document.body.append(host);
      let editor;
      try {
        editor = new CanvasEditor(host, { ...pkg, images });
        return { pages: editor.layout.pages.length, readOnly: editor.readOnly, strictError,
          execution: { flow: globalThis.__alignedFlowExecuted || 0, layout: globalThis.__alignedLayoutExecuted || 0, pagination: globalThis.__alignedPaginationExecuted || 0 },
          frames: editor.layout.floatingTables,
          lines: editor.layout.lines.map(l => ({ page: l.page, text: l.fragments.map(f => f.text || '').join(''),
            xPt: l.fragments[0]?.x * .75, baselinePt: l.baseline * .75 })) };
      } catch (error) { return { error: error.message }; }
      finally { editor?.destroy(); host.remove(); }
    }, [...bytes]);
    if (mode === 'baseline') {
      if (manifest.rowsPerTable > 3) { assert.match(result.strictError || '', /Multi-page floating tables/); assert.equal(result.readOnly, true); }
      else { assert.equal(result.readOnly, false); assert(!result.strictError); }
    }
    else {
      assert(routed >= 1, 'Candidate module must actually execute');
      assert(result.execution.flow >= 1, 'Served flow candidate must execute');
      if (pageAware) assert(layoutRouted >= 1);
      if (pageAware) assert(paginationRouted >= 1);
      if (pageAware) {
        assert(result.execution.layout >= 1, 'Served layout candidate must execute');
        assert(result.execution.pagination >= 1, 'Served pagination candidate must execute');
      }
      assert(!result.error, result.error);
      assert.equal(result.readOnly, false, 'Candidate must reach the unguarded layout');
      const normalize = text => text.replace(/\s/g, '');
      const labels = manifest.alignments || manifest.cases.map(c => c.label);
      const rows = native.lines.filter(l => labels.some(label => l.text.startsWith(`${label}row`) && /^\d+$/.test(l.text.slice(`${label}row`.length))));
      assert.equal(rows.length, labels.length * manifest.rowsPerTable);
      result.predictionMismatches = [];
      if (manifest.cases) for (const testCase of manifest.cases) {
        const pages = rows.filter(l => l.text.startsWith(`${testCase.label}row`)).map(l => l.page);
        if (Math.min(...pages) !== testCase.predictedFirstPage || Math.max(...pages) !== testCase.predictedLastPage)
          result.predictionMismatches.push({ label: testCase.label, expectedFirst: testCase.predictedFirstPage,
            expectedLast: testCase.predictedLastPage, actualFirst: Math.min(...pages), actualLast: Math.max(...pages) });
      }
      result.comparison = rows.map(expected => {
        const actual = result.lines.filter(l => normalize(l.text) === expected.text);
        assert.equal(actual.length, 1, `Identity ${expected.text}`);
        return { text: expected.text, nativePage: expected.page, actualPage: actual[0].page,
          xDeltaPt: actual[0].xPt - expected.x, baselineDeltaPt: actual[0].baselinePt - expected.y };
      });
      result.pageMismatches = result.comparison.filter(r => r.nativePage !== r.actualPage).length;
      result.maxXDeltaPt = Math.max(...result.comparison.map(r => Math.abs(r.xDeltaPt)));
      result.maxBaselineDeltaPt = Math.max(...result.comparison.map(r => Math.abs(r.baselineDeltaPt)));
      result.withinOriginBounds = result.pageMismatches === 0 && result.maxXDeltaPt <= .35 && result.maxBaselineDeltaPt <= .15;
    }
    results.push({ mode, routed, routedUrls, layoutRouted, paginationRouted, ...result }); await context.close();
  }
  const report = { scope: 'Independent numeric placement diagnostic; no runtime change, glyph or native raster certification.',
    sourceSha256: digest(bytes), nativePdfSha256: native.nativePdfSha256, referenceBuild: native.referenceBuild,
    browserVersion: browser.version(), tableReaderModuleSha256: digest(tableReader), originalModuleSha256: digest(original), candidateModuleSha256: digest(candidate), layoutModuleSha256: digest(layoutOriginal), candidateLayoutSha256: digest(layoutCandidate), paginationModuleSha256: digest(paginationOriginal), candidatePaginationSha256: digest(paginationCandidate), firstPageCandidateSha256: digest(pageCandidate), results };
  assert.equal(digest(readFileSync('src/engine/docx-tables.js')), digest(tableReader), 'Table reader changed during diagnostic');
  assert.equal(readFileSync(join(engineDirectory, 'floating-table-flow.js'), 'utf8'), original, 'Flow module changed during diagnostic');
  assert.equal(readFileSync(join(engineDirectory, 'layout.js'), 'utf8'), layoutOriginal, 'Layout module changed during diagnostic');
  assert.equal(readFileSync(join(engineDirectory, 'pagination.js'), 'utf8'), paginationOriginal, 'Pagination module changed during diagnostic');
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(results.map(({ mode, error, pages, pageMismatches, maxXDeltaPt, maxBaselineDeltaPt }) =>
    ({ mode, error, pages, pageMismatches, maxXDeltaPt, maxBaselineDeltaPt }))));
  assert(results.find(r => r.mode === 'initial-page-side').withinOriginBounds,
    'First-page candidate exceeds bounded origin checks; report preserved for counterexample review');
} finally { await browser.close(); }
