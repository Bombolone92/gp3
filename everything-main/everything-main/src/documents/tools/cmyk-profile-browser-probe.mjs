// Diagnostic companion to cmyk_profile_probe.py. No app code or source DOCX changes.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node tools/cmyk-profile-browser-probe.mjs input.jpg output.json');
const bytes = readFileSync(input), browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const results = await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const colors = image => {
      const canvas = new OffscreenCanvas(256, 128), context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return Array.from({ length: 16 }, (_, i) => Array.from(context.getImageData(i % 4 * 64 + 32, Math.floor(i / 4) * 32 + 16, 1, 1).data).slice(0, 3));
    };
    const bitmap = await createImageBitmap(blob), bitmapColors = colors(bitmap); bitmap.close();
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image(); image.src = url; await image.decode();
      return { bitmapColors, imageColors: colors(image) };
    } finally { URL.revokeObjectURL(url); }
  }, bytes.toString('base64'));
  const result = { browser: browser.version(), jpegSha256: createHash('sha256').update(bytes).digest('hex'), ...results };
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
