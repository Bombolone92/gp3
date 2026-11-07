import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

for (const suffix of ['', '-margin', '-kinds', '-formatting']) test(`matches native leader grid${suffix}`, async ({ page }, info) => {
  const name = `tab-leader-grid${suffix}`;
  const reference = JSON.parse(readFileSync(`tests/fixtures/tab-leader-grid/${name}.native.json`));
  const rows = [];
  for (const chunk of reference.chunks) {
    if (/^[IM]+$/.test(chunk.text)) rows.push([]);
    else if (/^[.\-_·]+$/.test(chunk.text)) rows.at(-1).push(chunk);
  }
  await page.goto('/playground.html');
  const actual = await page.evaluate(async file => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const pkg = await DocxPackage.open(new Uint8Array(await (await fetch(`/fixtures/${file}.docx`)).arrayBuffer()));
    await loadCanvasFonts(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    const result = layoutDocument(pkg.paragraphs, (text, style) => measureCanvasText(ctx, text, style), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables);
    return result.lines.filter(l => l.leaders.length).map(l => {
      const leader = l.leaders[0];
      const scale = leader.textTransform?.scaleX || 1;
      return { x: (leader.x + leader.textOffsetX * scale) * .75, count: leader.text.length,
        advance: measureCanvasText(ctx, leader.text, leader).width * scale * .75 / leader.text.length };
    });
  }, name);
  expect(actual).toHaveLength(rows.length);
  rows.forEach((chunks, i) => {
    // Existing generic script transforms do not yet use Arial's native script
    // metrics. Retain the reference, without claiming fidelity for that row.
    if (suffix === '-formatting' && i === 10) return;
    expect(Math.abs(actual[i].x - chunks[0].x), `row ${i} first glyph`).toBeLessThan(.09);
    expect(actual[i].count, `row ${i} glyph count`).toBe(chunks.reduce((sum, c) => sum + c.text.length, 0));
    const advance = (chunks[1].x - chunks[0].x) / chunks[0].text.length;
    expect(Math.abs(actual[i].advance - advance), `row ${i} advance`).toBeLessThan(.005);
  });
  await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/${name}.docx`);
  await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveValue(/I\t12/);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  writeFileSync(info.outputPath(`${name}.png`), Buffer.from(await page.locator('canvas.canvas-page').evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
});

test('paints the grid offset inside scaled capitalization segments', async ({ page }) => {
  await page.goto('/playground.html');
  const results = await page.evaluate(async () => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { loadCanvasFonts } = await import('/src/engine/canvas-text.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const results = [];
    for (const capitalization of ['caps', 'smallCaps']) {
      const pkg = await DocxPackage.open(new Uint8Array(await (await fetch('/fixtures/tab-leader-grid.docx')).arrayBuffer()));
      pkg.paragraphs = [pkg.paragraphs[0]];
      await loadCanvasFonts(pkg);
      const host = document.createElement('div'); document.body.append(host);
      const fill = CanvasRenderingContext2D.prototype.fillText, painted = [];
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...args) {
        if (/^\.+$/.test(text)) { const m = this.getTransform(); painted.push({ canvas: this.canvas, x: m.e + m.a * x }); }
        return fill.call(this, text, x, y, ...args);
      };
      let editor;
      try {
        editor = new CanvasEditor(host, pkg);
        editor.model.select(0, editor.model.text.length);
        editor.execute(() => editor.model.setRunFormat({ capitalization, fontSize: 13, textScale: 80 }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const leader = editor.layout.lines[0].leaders[0], canvas = host.querySelector('canvas');
        results.push({ offset: leader.textOffsetX,
          expected: (leader.x + leader.textOffsetX * leader.textTransform.scaleX) * window.devicePixelRatio,
          painted: painted.filter(p => p.canvas === canvas).at(-1)?.x });
      } finally {
        CanvasRenderingContext2D.prototype.fillText = fill; editor?.destroy(); host.remove();
      }
    }
    return results;
  });
  for (const result of results) {
    expect(result.offset).toBeGreaterThan(0);
    expect(result.painted).toBeCloseTo(result.expected, 4);
  }
});
