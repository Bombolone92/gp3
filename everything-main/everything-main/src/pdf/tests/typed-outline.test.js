import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { drawSignature, typedOutline } from '../src/core/signature.js';
import { stampOutline } from '../src/core/stamp.js';

describe.each(['GreatVibes-Regular', 'NotoSans-Regular'])('%s typed outlines', (name) => {
  let bytes;
  const family = `Outline-Test-${name}`;
  beforeAll(async () => {
    const file = new URL(`../public/fonts/${name}.ttf`, import.meta.url);
    bytes = await readFile(file);
    GlobalFonts.registerFromPath(file.pathname, family);
  });

  it.each(['a\u0308\u0301', 'A\u0308\u0301', 'b\u0308\u0301', 'B\u0308\u0301'])(
    'renders stacked accents in %s like the native font shaper',
    async (text) => {
      const reference = createCanvas(900, 800),
        actual = createCanvas(900, 800);
      for (const canvas of [reference, actual]) {
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#000';
      }
      // Native text shaping supplies an independent reference for the font's positioning rules.
      const native = reference.getContext('2d');
      native.font = `400px "${family}"`;
      native.fillText(text, 200, 600);
      const outline = typedOutline(fontkit, bytes, text);
      const box = outline.box;
      const doc = await PDFDocument.create();
      doc.addPage([900, 800]);
      await drawSignature(
        doc,
        0,
        { type: 'type', text },
        {
          x: 200 + box.x * 0.4,
          y: 200 + box.y * 0.4,
          width: box.width * 0.4,
          height: box.height * 0.4,
        },
        { outline, hex: '#000000' },
      );
      const context = actual.getContext('2d');
      const task = pdfjs.getDocument({ data: await doc.save() });
      try {
        const page = await (await task.promise).getPage(1);
        await page.render({ canvasContext: context, viewport: page.getViewport({ scale: 1 }) })
          .promise;
      } finally {
        await task.destroy();
      }
      const expected = native.getImageData(0, 0, 900, 800).data,
        drawn = context.getImageData(0, 0, 900, 800).data;
      let ink = 0,
        difference = 0,
        outside = 0;
      for (let y = 0; y < 800; y++)
        for (let x = 0; x < 900; x++) {
          const at = (y * 900 + x) * 4;
          ink += 255 - expected[at];
          difference += Math.abs(expected[at] - drawn[at]);
          if (
            drawn[at] < 128 &&
            (x < 200 + box.x * 0.4 - 1 ||
              x > 200 + (box.x + box.width) * 0.4 + 1 ||
              y < 600 - (box.y + box.height) * 0.4 - 1 ||
              y > 600 - box.y * 0.4 + 1)
          )
            outside++;
        }
      expect(ink).toBeGreaterThan(100000);
      // Native font hinting and unhinted paths have slightly different pixel edges.
      expect(difference / ink).toBeLessThan(0.08);
      expect(outside).toBe(0);
    },
  );

  it.each(['ä\u0301', 'ḃ', 'Å', 'Å\u0301'])(
    'draws canonically equivalent spellings of %s identically',
    (text) => {
      for (const outline of [typedOutline, stampOutline])
        expect(outline(fontkit, bytes, text.normalize('NFD'))).toEqual(
          outline(fontkit, bytes, text.normalize('NFC')),
        );
    },
  );

  it('uses supported decomposed glyphs when the composed letter is missing', () => {
    const fallback = name === 'GreatVibes-Regular' ? 'Ӂ' : '≠';
    const font = fontkit.create(bytes);
    expect(font.hasGlyphForCodePoint(fallback.codePointAt(0))).toBe(false);
    for (const character of fallback.normalize('NFD'))
      expect(font.hasGlyphForCodePoint(character.codePointAt(0))).toBe(true);
    // Include another cluster that needs composition, so a fallback cannot skip the rest.
    const text = `Ä\u0301 ${fallback}`;
    for (const outline of [typedOutline, stampOutline])
      expect(outline(fontkit, bytes, text.normalize('NFC'))).toEqual(
        outline(fontkit, bytes, text.normalize('NFD')),
      );
  });

  it.each([
    '\u200b',
    '\u200b \u200b',
    ...(name === 'NotoSans-Regular' ? ['\u200c\u200d', '\u034f', '\u00ad', '\u2060'] : []),
  ])('rejects invisible-only text %j without rejecting it alongside visible letters', (text) => {
    for (const outline of [typedOutline, stampOutline]) {
      expect(() => outline(fontkit, bytes, text)).toThrow('visible character');
      expect(outline(fontkit, bytes, `A${text}`).commands.length).toBeGreaterThan(0);
    }
  });
});
