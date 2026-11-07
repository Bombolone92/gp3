// Capture the independently authored junction fixture. Requires installed
// Arial and Franklin Gothic Book; local font files are never exported.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = resolve(process.argv[2] || 'test-results-text3d-junctions');
const url = process.argv[3] || 'http://127.0.0.1:5173/playground.html';
const source = process.argv[4] ? resolve(process.argv[4]) : fileURLToPath(new URL('../tests/fixtures/text-3d/junctions.docx', import.meta.url));
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ permissions: ['local-fonts'], deviceScaleFactor: 3 });
  page.setDefaultTimeout(180000);
  await page.goto(url);
  const installed = await page.evaluate(async () => (await window.queryLocalFonts()).map(face => face.family));
  for (const family of ['Arial', 'Franklin Gothic Book'])
    if (!installed.includes(family)) throw new Error(`Missing installed control font: ${family}`);
  const previous = await page.getByRole('textbox', { name: 'Document text' }).elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await page.waitForFunction(el => !el.isConnected, previous);
  await previous.dispose();
  await page.getByRole('button', { name: 'Download .docx', exact: true }).focus();
  const canvases = page.locator('canvas.canvas-page');
  if (await canvases.count() !== 6) throw new Error('Expected six junction-control pages.');
  for (let index = 0; index < 6; index++) {
    const data = await canvases.nth(index).evaluate(canvas => canvas.toDataURL());
    writeFileSync(resolve(output, `text3d-junction-page${index + 1}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
} finally { await browser.close(); }
