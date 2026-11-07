// Read only already authorized, installed font data. Output metrics/hashes,
// never font binaries. This supports the original legacy-space-variants control.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const output = process.argv[2];
if (!output) throw Error('Usage: node tools/inspect-legacy-space-fonts.mjs <output.json>');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ permissions: ['local-fonts'] });
  await page.goto('http://127.0.0.1:5173/playground.html');
  const rows = await page.evaluate(async () => {
    const { localFamilyFontData } = await import('/src/engine/local-fonts.js');
    const { parse } = await import('/node_modules/opentype.js/dist/opentype.mjs');
    const faces = (await localFamilyFontData('Rockwell')).filter(({ metadata }) =>
      metadata?.widthClass === 5 && [400, 700].includes(metadata.weight));
    if (faces.length !== 4) throw Error('The control requires all four installed, normal-width Rockwell faces.');
    return Promise.all(faces.map(async ({ fullName, buffer, metadata }) => {
      const font = parse(buffer), space = font.charToGlyph(' '), nbsp = font.charToGlyph('\u00a0'), next = font.charToGlyph('W');
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      return { fullName, weight: metadata.weight, italic: metadata.italic, widthClass: metadata.widthClass,
        unitsPerEm: font.unitsPerEm,
        space: { glyph: space.index, advance: space.advanceWidth },
        nbsp: { glyph: nbsp.index, advance: nbsp.advanceWidth },
        spaceW: font.kerningPairs[`${space.index},${next.index}`] || 0,
        nbspW: font.kerningPairs[`${nbsp.index},${next.index}`] || 0,
        sha256: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') };
    }));
  });
  rows.sort((a, b) => a.fullName.localeCompare(b.fullName));
  writeFileSync(output, JSON.stringify(rows, null, 2) + '\n');
  console.log(`Recorded space/NBSP metadata for ${rows.length} installed faces; no font binaries saved.`);
} finally { await browser.close(); }
