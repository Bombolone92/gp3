import { test, expect } from '@playwright/test';

test('private separator mapping preserves ordinary native glyph paint and advances', async ({ page }) => {
  await page.context().grantPermissions(['local-fonts']);
  await page.goto('/playground.html');
  const result = await page.evaluate(async () => {
    const { literalSeparatorFont, LITERAL_SEPARATOR_ALIAS } = await import('/src/engine/literal-separator-font.js');
    const { localFamilyFontData } = await import('/src/engine/local-fonts.js');
    const { parse } = await import('/src/vendor/opentype/opentype.mjs');
    const faces = await localFamilyFontData('Times New Roman');
    const rows = [];
    for (const [weight, italic] of [[400, false], [700, false], [400, true], [700, true]]) {
      const source = faces.find(f => f.metadata.weight === weight && f.metadata.italic === italic && f.metadata.widthClass === 5);
      if (!source) throw new Error(`Native control requires Times New Roman ${weight}/${italic}`);
      const before = new Uint8Array(source.buffer).slice(), derived = literalSeparatorFont(source.buffer);
      if (!derived) throw new Error('Native face could not be mapped');
      const original = await new FontFace('SeparatorOriginal', source.buffer, {weight:String(weight),style:italic?'italic':'normal'}).load();
      const adjusted = await new FontFace('SeparatorAdjusted', derived, {weight:String(weight),style:italic?'italic':'normal'}).load();
      const scoped = await new FontFace('SeparatorScoped', derived, {weight:String(weight),style:italic?'italic':'normal',unicodeRange:'U+FFFF'}).load();
      document.fonts.add(original); document.fonts.add(adjusted); document.fonts.add(scoped);
      try {
        const font = parse(source.buffer), glyph = font.charToGlyph('\u2028');
        const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 160;
        const context = canvas.getContext('2d'); context.fontKerning = 'none';
        const paint = (family, text, size, native = true) => {
          context.clearRect(0, 0, 600, 160); const families=family==='SeparatorScoped'?'"Times New Roman", "SeparatorScoped"':`"${family}"`; context.font = `${native && italic ? 'italic ' : ''}${native ? weight + ' ' : ''}${size}px ${families}`;
          context.fillText(text, 20, 110);
          return { width: context.measureText(text).width, pixels: context.getImageData(0, 0, 600, 160).data };
        };
        for (const size of [12, 48, 96]) for(const plain of ['AV fi 0123 éΩЖ','漢字 العربية עברית']) {
          const old = paint('SeparatorOriginal', plain, size), current = paint('SeparatorAdjusted', plain, size);
          const system = paint('Times New Roman', plain, size, true), runtime=paint('SeparatorScoped', plain, size);
          const normalIdentical = old.width === current.width && old.pixels.every((v, i) => v === current.pixels[i]);
          const systemIdentical = system.width === runtime.width && system.pixels.every((v, i) => v === runtime.pixels[i]);
          const raw = paint('SeparatorOriginal', '\u2028', size), alias = paint('SeparatorScoped', LITERAL_SEPARATOR_ALIAS, size);
          const count = pixels => pixels.reduce((n, v, i) => n + (i % 4 === 3 && v > 0 ? 1 : 0), 0);
          const a = paint('SeparatorAdjusted', 'A', size).width, b = paint('SeparatorAdjusted', 'B', size).width;
          const middle = paint('SeparatorAdjusted', 'A' + LITERAL_SEPARATOR_ALIAS + 'B', size).width;
          rows.push({ weight, italic, size, normalIdentical, systemIdentical, rawInk: count(raw.pixels), aliasInk: count(alias.pixels),
            width: alias.width, expectedWidth: glyph.advanceWidth / font.unitsPerEm * size,
            middle, expectedMiddle: a + alias.width + b,
            sourceUnchanged: before.every((v, i) => v === new Uint8Array(source.buffer)[i]) });
        }
      } finally { document.fonts.delete(original); document.fonts.delete(adjusted); document.fonts.delete(scoped); }
    }
    return rows;
  });
  expect(result).toHaveLength(24);
  for (const row of result) {
    expect(row.normalIdentical, JSON.stringify(row)).toBe(true);
    expect(row.systemIdentical, JSON.stringify(row)).toBe(true);
    expect(row.sourceUnchanged).toBe(true);
    expect(row.rawInk).toBe(0); expect(row.aliasInk).toBeGreaterThan(0);
    expect(row.width).toBeCloseTo(row.expectedWidth, 5);
    expect(row.middle).toBeCloseTo(row.expectedMiddle, 5);
  }
});
