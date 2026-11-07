import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
for (const kind of ['flat-lines', 'relative-flat-lines', 'straight-flat-lines', 'straight-oval-lines']) {
const folder = `tests/fixtures/${kind}`;
const source = readFileSync(`${folder}/flat-lines.docx`);
const reference = JSON.parse(readFileSync(`${folder}/reference.json`, 'utf8'));

test(`renders and selects ${kind} like the native reference, retaining edits and exact undo`, async ({ page }, info) => {
  test.setTimeout(120000);
  expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
  expect(createHash('sha256').update(readFileSync(`${folder}/native.pdf`)).digest('hex')).toBe(reference.pdfSha256);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/flat-lines.docx`);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(kind === 'relative-flat-lines' ? /^Case 1:/ : /^Horizontal/); await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.cases.length);
  const ink = await page.locator('canvas.canvas-page').evaluateAll(pages => pages.map(c => {
    const data = c.getContext('2d').getImageData(0,0,c.width,c.height).data, scale = 612/c.width;
    let left=Infinity, top=Infinity, right=-Infinity, bottom=-Infinity;
    for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++) {
      const i=(y*c.width+x)*4;
      if(data[i]>160 && data[i+1]<100 && data[i+2]<120) { left=Math.min(left,x); top=Math.min(top,y); right=Math.max(right,x+1); bottom=Math.max(bottom,y+1); }
    }
    return {left:left*scale,top:top*scale,right:right*scale,bottom:bottom*scale};
  }));
  writeFileSync(info.outputPath('ink.json'), JSON.stringify(ink,null,2));
  for(const [i,box] of ink.entries()) for(const key of Object.keys(box)) expect(Math.abs(box[key]-reference.cases[i][key]), `page ${i+1} ${key}`).toBeLessThan(1);
  const hits = await page.evaluate(async ({ bytes, boxes }) => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { layoutDocument, imageAtPoint, selectionRects } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(bytes), c=>c.charCodeAt(0)));
    await loadCanvasFonts(pkg); const ctx=document.createElement('canvas').getContext('2d');
    const placed=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
    return boxes.map((b,i)=>{
      const hit=imageAtPoint(placed,i,(b.left+b.right)/1.5,(b.top+b.bottom)/1.5);
      const outside=imageAtPoint(placed,i,(b.left-20)/.75,(b.top-20)/.75);
      return {id:hit?.image.id,outside:!!outside,rects:hit?selectionRects(placed,hit.start,hit.end):[]};
    });
  }, {bytes:source.toString('base64'),boxes:reference.cases});
  hits.forEach((h,i)=>{expect(h.id).toBe(i+1);expect(h.outside).toBe(false);expect(h.rects.some(r=>r.width>0&&r.height>0)).toBe(true);});
  for (const i of [0,1,2,3,6,7]) {
    const canvas = page.locator('canvas.canvas-page').nth(i), b = reference.cases[i];
    const scale = await canvas.evaluate(c=>c.getBoundingClientRect().width/612);
    await canvas.click({position:{x:(b.left+b.right)/2*scale,y:(b.top+b.bottom)/2*scale}});
    await expect.poll(()=>input.evaluate(e=>e.selectionEnd-e.selectionStart)).toBe(1);
  }
  const original=await input.inputValue(), parts=unzipSync(source);
  const save=async name=>{const next=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`${name}.docx`);await(await next).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+End');await page.keyboard.insertText(' EDIT');
  const edited=await save('edited'), changed=unzipSync(readFileSync(edited));
  for(const name of Object.keys(parts)) if(name!=='word/document.xml') expect(changed[name],name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,original+' EDIT');await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.cases.length);
  await expect(page.locator('#playground-error')).toBeEmpty();expect(errors).toEqual([]);
});
}
