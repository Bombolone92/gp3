import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

const root = 'tests/fixtures/theme-minmax-neighbors/';
const source = root + 'theme-minmax-neighbors-20261004.docx';
const native = JSON.parse(readFileSync(root + 'reference.json')).colors;

test('paints all native chromatic neighbor fills and preserves raw themes across edits', async ({page}, info) => {
  test.setTimeout(180000);
  const parts = unzipSync(readFileSync(source)), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', {name: 'Document text'});
  await expect(input).toHaveValue(/^C000/, {timeout: 60000});
  await expect(input).toHaveJSProperty('readOnly', false);
  const original = await input.inputValue();
  expect(original.match(/C\d{3}/g)).toHaveLength(208);
  const check = async () => {
    await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
    await expect.poll(() => page.locator('canvas.canvas-page').evaluateAll((canvases, rows) => rows.map((row, index) => {
      const local = index - rows.findIndex(r => r.page === row.page);
      const canvas = canvases[row.page], x = Math.round(216 * canvas.width / 612);
      const y = Math.round((46 + 20 * local) * canvas.height / 792);
      return [...canvas.getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3);
    }), native), {timeout: 30000}).toEqual(native.map(row => row.rgb));
  };
  const save = async (name, edited) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Download .docx', exact: true}).click();
    const path = info.outputPath(name + '.docx'); await (await pending).saveAs(path);
    const exported = unzipSync(readFileSync(path));
    expect(Object.keys(exported).sort()).toEqual(Object.keys(parts).sort());
    for (const key of Object.keys(parts)) if (!edited || key !== 'word/document.xml') expect(exported[key], key).toEqual(parts[key]);
    return path;
  };
  await check(); await save('noedit', false);
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  await expect(input).toHaveValue('Edited ' + original); await check();
  const edited = await save('edited', true);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original); await save('undo', false); await check();
  await reopenDocx(page, input, edited, 'Edited ' + original); await check();
  expect(errors).toEqual([]); await expect(page.locator('#playground-error')).toBeEmpty();
});
