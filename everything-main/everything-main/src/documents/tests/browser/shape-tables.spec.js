import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

const folder = 'tests/fixtures/shape-tables';
const reference = JSON.parse(readFileSync(`${folder}/reference.json`));

test('lays out standalone, grouped, merged and clipped shape tables against the native reference', async ({ page }) => {
  test.setTimeout(120000);
  for (const [name, hash] of Object.entries(reference.hashes)) expect(createHash('sha256').update(readFileSync(`${folder}/${name}`)).digest('hex')).toBe(hash);
  await page.goto('/playground.html');
  const result = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { validateCanvasLayout, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { checkFontAvailability, fontAvailable } = await import('/src/engine/font-availability.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { layoutShapeText } = await import('/src/engine/shape-text-layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { decodeShape } = await import('/src/engine/canvas-shapes.js');
    const { paintDecodedImage } = await import('/src/engine/images.js');
    await checkFontAvailability('Arial'); if (!fontAvailable('Arial')) return { missingFont: true };
    const pkg = await DocxPackage.open(new Uint8Array(bytes)); await validateCanvasLayout(pkg);
    const context = new OffscreenCanvas(1,1).getContext('2d'), measure = (t,s) => measureCanvasText(context,t,s);
    const layout = layoutDocument(pkg.paragraphs,measure,pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
    const lines = [];
    const add = (row,page,x=0,y=0) => {
      const fs = row.fragments.filter(f => !f.image); if (!fs.length) return;
      lines.push({page,text:fs.map(f=>f.text).join('').trim(),x:(x+fs[0].x)*.75,y:(y+row.baseline)*.75});
    };
    const walk = (node,x,y,sx,sy,page) => {
      if(node.type === 'group') {
        const rx=sx*node.width/node.childWidth,ry=sy*node.height/node.childHeight;
        for(const child of node.children) walk(child,x+(child.x-node.childX)*rx,y+(child.y-node.childY)*ry,rx,ry,page);
      } else if(node.text) {
        const text=layoutShapeText(node,measure,{x:sx*9525,y:sy*9525});
        for(const row of text.layout.lines) add(row,page,x+text.left,y+text.top+text.shift);
      }
    };
    for(const row of layout.lines) {
      add(row,row.page);
      for(const f of row.fragments) if(f.image) {
        const a=pkg.assets[f.image.assetId];
        walk(a.scene,f.x,row.baseline-f.ascent,a.width/a.scene.width,a.height/a.scene.height,row.page);
      }
    }
    const asset=Object.values(pkg.assets).find(a=>a.scene?.text?.tables);
    const shape=layoutShapeText(asset.scene,measure),rule=shape.layout.tableBorders.find(b=>!b.guide&&b.border.size===2);
    const decoded=await decodeShape(asset,new Map(),pkg.styles.fontAlternatives),coverage=[];
    try {
      for(const phase of [.13,.63]) {
        const c=new OffscreenCanvas(600,400),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,600,400);
        paintDecodedImage(ctx,decoded,24,24+phase,asset.width,asset.height);
        const x=Math.floor(24+shape.left+rule.x+rule.width/2),y=Math.floor(24+phase+shape.top+shape.shift+rule.y);
        const pixels=ctx.getImageData(x,y-1,1,4).data;
        coverage.push(Array.from({length:4},(_,i)=>pixels[i*4+2]-pixels[i*4]).some(v=>v>8));
      }
    } finally { decoded.close(); }
    return {lines,pages:layout.pageCount,coverage};
  }, [...readFileSync(`${folder}/source.docx`)]);
  test.skip(result.missingFont, 'Native reference coordinates require installed Arial; no fonts are redistributed.');
  expect(result.pages).toBe(4);
  expect(result.coverage).toEqual([true,true]);
  for(const native of reference.tables) {
    const actual=result.lines.find(l=>l.page===native.page&&l.text===native.text);
    expect(actual,native.text).toBeTruthy();
    expect(Math.abs(actual.x-native.x),native.text).toBeLessThan(.2);
    expect(Math.abs(actual.y-native.y),native.text).toBeLessThan(.3);
  }
});

for(const name of ['source','symbols']) test(`preserves ${name} drawing XML through editing, undo and reopen`, async ({page},info) => {
  test.setTimeout(120000);
  await page.goto('/playground.html');
  const source=`${folder}/${name}.docx`,parts=unzipSync(readFileSync(source));
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(name==='source'?/After drawing$/:/After symbols$/);
  await expect(input).toHaveJSProperty('readOnly',false);
  const original=await input.inputValue();
  const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`${name}-${suffix}.docx`);await(await pending).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const text=await input.inputValue(),edited=await save('edited'),after=unzipSync(readFileSync(edited));
  expectBodyEditParts(after,parts);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,text);await expect(page.locator('#playground-error')).toBeEmpty();
});
