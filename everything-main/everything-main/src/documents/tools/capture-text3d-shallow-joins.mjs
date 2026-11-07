// Called while the generator's original test font is temporarily registered.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve(process.argv[2]);
const url = process.argv[3] || 'http://127.0.0.1:5173/playground.html';
const source = resolve(output,'control.docx');
const expectedPages = Number(process.argv[5] || 5);
if (!Number.isInteger(expectedPages) || expectedPages < 1) throw new Error('Invalid control page count.');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ permissions: ['local-fonts'], deviceScaleFactor: 3 });
  page.setDefaultTimeout(180000);
  await page.goto(url);
  const installed = await page.evaluate(async () => (await window.queryLocalFonts()).map(face => face.family));
  for (const family of [process.argv[4] || 'Shallow Join Complete 1000'])
    if (!installed.includes(family)) throw new Error(`Missing installed control font: ${family}`);
  const previous = await page.getByRole('textbox', { name: 'Document text' }).elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await page.waitForFunction(el => !el.isConnected, previous);
  await previous.dispose();
  await page.getByRole('button', { name: 'Download .docx', exact: true }).focus();
  const canvases = page.locator('canvas.canvas-page');
  if (await canvases.count() !== expectedPages) throw new Error(`Expected ${expectedPages} control pages.`);
  for (let index = 0; index < expectedPages; index++) {
    const data = await canvases.nth(index).evaluate(canvas => canvas.toDataURL());
    writeFileSync(resolve(output, `text3d-junction-page${index + 1}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
} finally { await browser.close(); }
