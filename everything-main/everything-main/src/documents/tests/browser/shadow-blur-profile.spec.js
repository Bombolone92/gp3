import {test, expect} from '@playwright/test';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const folder = 'tests/fixtures/shadow-blur-profile/';
async function compareProfiles(page, info) {
  const ref = JSON.parse(readFileSync(folder+'reference.json'));
  for (const [name, hash] of [['source.docx', ref.sourceSha256], ['native.pdf', ref.pdfSha256]]) {
    expect(createHash('sha256').update(readFileSync(folder+name)).digest('hex')).toBe(hash);
  }
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(folder+'source.docx');
  await expect(page.getByRole('textbox', {name:'Document text'})).toHaveValue(/^square-72-blur-0/);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages.length);
  const results = await page.locator('canvas.canvas-page').evaluateAll((canvases, pages) => pages.map((p, i) => {
    const canvas = canvases[i], ctx = canvas.getContext('2d'), scale = canvas.width/612;
    const errors = p.samples.map(([x,y,lo,hi]) => {
      const actual = Array.from(ctx.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data).slice(0,3);
      return {x,y,lo,hi,actual,error:Math.max(...actual.map(v=>Math.max(lo-v,v-hi,0)))};
    }).filter(s=>s.error>4);
    return {name:p.name, errors};
  }), ref.pages);
  await info.attach('shadow-profile-results', {body:JSON.stringify(results,null,2), contentType:'application/json'});
  writeFileSync(info.outputPath('profiles.json'), JSON.stringify(results,null,2)+'\n');
  return results;
}

test('opaque square shadows match the native reference for eleven size and radius pairs', async ({page}, info) => {
  const results = await compareProfiles(page, info);
  for (const result of results.filter(p=>p.name!=='square-72-blur-48')) expect(result.errors,result.name).toEqual([]);
});

test('wide blur on a small opaque square matches native shadow density', async ({page}, info) => {
  const results = await compareProfiles(page, info);
  expect(results.find(p=>p.name==='square-72-blur-48').errors).toEqual([]);
});
