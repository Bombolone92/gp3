import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';

const folder = 'tests/fixtures/numbering-identity-recovery/';
const variants = ['duplicate-abstract', 'duplicate-instance', 'invalid-abstract', 'missing-abstract', 'invalid-instance', 'missing-instance', 'zero-instance', 'combined'];

test('malformed numbering identities preserve healthy list pixels and rich content', async ({ page }, info) => {
  test.setTimeout(240000);
  await page.goto('/playground.html', {waitUntil:'domcontentloaded'});
  const inputs = Object.fromEntries(variants.map(name => [name, [...readFileSync(`${folder}${name}.docx`)]]));
  inputs.healthy = [...readFileSync('tests/fixtures/numbering-definition-recovery/healthy.docx')];
  const rendered = await page.evaluate(async inputs => {
    const {openCanvasDocument} = await import('/src/engine/open-document.js');
    const {CanvasEditor} = await import('/src/engine/canvas-editor.js');
    const result = {};
    for (const [name, bytes] of Object.entries(inputs)) {
      const {pkg, images} = await openCanvasDocument(Uint8Array.from(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [];
      const editor = new CanvasEditor(host, {...pkg, images, onError:error=>errors.push(error.message)});
      result[name] = {readOnly:!!pkg.readOnly, issues:pkg.previewIssues, tables:pkg.tables.length, decoded:images.size, errors,
        pixels:editor.canvases.map(c=>c.toDataURL()),
        lines:[...editor.layout.lines,...editor.storyLayout.lines].map(l=>({page:l.page,y:l.y,height:l.height,baseline:l.baseline,
          fragments:l.fragments.map(f=>({text:f.text,x:f.x,width:f.width,bold:f.bold}))}))};
      editor.destroy();host.remove();
    }
    return result;
  }, inputs);
  expect(rendered.healthy.readOnly).toBe(false);
  expect(rendered.healthy.decoded).toBeGreaterThan(0);
  expect(rendered.healthy.tables).toBe(1);
  for (const name of variants) {
    const actual = rendered[name];
    expect(actual.readOnly, name).toBe(true);
    expect(actual.issues.join(' '), name).toContain('word/numbering.xml');
    expect(actual.errors, name).toEqual([]);
    expect(actual.tables, name).toBe(rendered.healthy.tables);
    expect(actual.decoded, name).toBe(rendered.healthy.decoded);
    expect(actual.lines, name).toEqual(rendered.healthy.lines);
    expect(actual.pixels, name).toEqual(rendered.healthy.pixels);
  }
  for (const [i, png] of rendered.combined.pixels.entries()) writeFileSync(info.outputPath(`recovered-${i+1}.png`), Buffer.from(png.split(',')[1], 'base64'));
});

test('identity recovery reports both failures and downloads the untouched original', async ({page}) => {
  test.setTimeout(120000);
  await page.goto('/playground.html', {waitUntil:'domcontentloaded'});
  await openReadOnlyPreview(page, `${folder}combined.docx`);
  const banner = page.locator('details').filter({hasText:'Unsupported features detected'});
  await banner.locator('summary').click();
  await expect(banner).toContainText('duplicate abstractNumId 1');
  await expect(banner).toContainText('duplicate numId 2');
});
