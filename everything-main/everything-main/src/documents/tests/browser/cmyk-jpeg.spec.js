import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const folder = 'tests/fixtures/cmyk-jpeg';
const ref = JSON.parse(readFileSync(`${folder}/reference.json`));

async function inspect(page, path) {
  return page.evaluate(async encoded => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { TextDocument } = await import('/src/engine/model.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const p = await DocxPackage.open(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
    await loadCanvasFonts(p);
    const d = new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
    const ctx = document.createElement('canvas').getContext('2d');
    const placed = layoutDocument(d.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(d.pageSettings),d.numbering,d.tables,p.pageStories,{styles:d.styles});
    return { pages: placed.pageCount, pictures: placed.lines.flatMap(l=>l.fragments.filter(f=>f.image).map(f=>{
      const canvas = document.querySelectorAll('canvas.canvas-page')[l.page], ratio = canvas.width/parseFloat(canvas.style.width);
      const top = l.baseline-f.ascent, context = canvas.getContext('2d');
      return {page:l.page,x:f.x*.75,y:top*.75,width:f.width*.75,height:f.ascent*.75,
        samples:[.125,.375,.625,.875].flatMap(y=>[.125,.375,.625,.875].map(x=>Array.from(context.getImageData(Math.round((f.x+x*f.width)*ratio),Math.round((top+y*f.ascent)*ratio),1,1).data).slice(0,3)))};
    })) };
  },readFileSync(path).toString('base64'));
}

for (const [index,label] of ['CMYK JPEG color conversion gap','RGB JPEG control'].entries()) {
  test(label, async ({page},info)=>{
    const source=`${folder}/control.docx`;
    expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(ref.sourceSha256);
    expect(createHash('sha256').update(readFileSync(`${folder}/native.pdf`)).digest('hex')).toBe(ref.pdfSha256);
    await page.goto('/playground.html');
    await page.getByLabel('Open DOCX file').setInputFiles(source);
    const input=page.getByRole('textbox',{name:'Document text'});
    await expect(input).toHaveValue(/naive-rgb/);await expect(input).toHaveJSProperty('readOnly',false);
    await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
    const actual=await inspect(page,source);
    expect(actual.pictures).toHaveLength(2);
    writeFileSync(info.outputPath('colors.json'),JSON.stringify({actual,word:ref},null,2));
    for(const axis of ['x','y','width','height'])expect(Math.abs(actual.pictures[index][axis]-ref.pictures[index][axis])).toBeLessThan(.2);
    if(index===0)test.fail(true,'Device CMYK JPEG conversion differs from the installed native reference; no ICC profile is present.');
    for(let j=0;j<16;j++)for(let k=0;k<3;k++)expect(Math.abs(actual.pictures[index].samples[j][k]-ref.pictures[index].samples[j][k]),`sample ${j} channel ${k}`).toBeLessThanOrEqual(1);
  });
}

test('device CMYK conversion matches the exact native metafile palette',async({page},info)=>{
 const native=JSON.parse(readFileSync(`${folder}/native-metafile-reference.json`)),source=`${folder}/control.docx`;
 const hash=b=>createHash('sha256').update(b).digest('hex');
 expect(hash(readFileSync(source))).toBe(native.sourceSha256);
 expect(hash(readFileSync(`${folder}/native-metafile.emf`))).toBe(native.metafileSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/naive-rgb/);
 const actual=await inspect(page,source);expect(actual.pictures).toHaveLength(2);
 writeFileSync(info.outputPath('metafile-colors.json'),JSON.stringify({actual:actual.pictures[0].samples,native:native.colors},null,2));
 test.fail(true,'Unprofiled CMYK browser conversion differs from exact native metafile RGB; PDF colors are a separate reference.');
 expect(actual.pictures[0].samples).toEqual(native.colors);
});
