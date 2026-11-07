import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const references=JSON.parse(readFileSync('tests/fixtures/svg-strokes/widths.json','utf8'));

for(const name of ['svg-strokes','svg-strokes-viewbox','svg-strokes-double-size','svg-strokes-scaled','svg-strokes-group','svg-strokes-primitives']) {
  test(`${name}: matches native stroke widths and preserves original artwork through edits`,async({page},info)=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('/playground.html');
    await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/${name}.docx`);
    const input=page.getByRole('textbox',{name:'Document text'});
    await expect(input).toHaveValue(/^SVG vector pictures/);
    const result=await page.evaluate(async name=>{
      const {DocxPackage}=await import('/src/engine/docx.js');
      const {decodeImages}=await import('/src/engine/images.js');
      const {svgInfo}=await import('/src/engine/svg-images.js');
      const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
      const p=await DocxPackage.open(new Uint8Array(await(await fetch(`/fixtures/${name}.docx`)).arrayBuffer()));
      const bytes=p.assets['word/media/vector.svg'].bytes, source=new TextDecoder().decode(bytes);
      const xml=new DOMParser().parseFromString(source,'image/svg+xml');
      const original=new XMLSerializer().serializeToString(xml);
      const root=nativeSvgStrokes(xml.documentElement,svgInfo(bytes));
      const widths=[...root.querySelectorAll('rect,line,path,circle')].map(n=>Number(n.style.strokeWidth||n.getAttribute('stroke-width')));
      const images=await decodeImages(p.assets), image=images.get('word/media/vector.svg');
      const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;
      const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,1200,800);c.drawImage(image,0,0,1200,800);
      let ink=0;
      if(name!=='svg-strokes-primitives') for(let x=60;x<100;x++) ink+=Math.max(0,1-c.getImageData(x,180,1,1).data[0]/232);
      images.forEach(i=>i.close());
      return {widths,ink,unchanged:new XMLSerializer().serializeToString(xml)===original};
    },name);
    // The reference PDF streams contain a 0.14-unit minimum; geometry conversion is
    // 0.12 per SVG unit, or 0.24 for doubled intrinsic dimensions/transforms.
    const word=references[name].svgWidths;
    expect(result.widths).toHaveLength(word.length);
    // CSSOM serializes these lengths to six significant digits.
    result.widths.forEach((width,i)=>expect(width).toBeCloseTo(word[i],4));
    if(name!=='svg-strokes-primitives') expect(Math.abs(result.ink/10-word[0])).toBeLessThan(.1);
    expect(result.unchanged).toBe(true);
    const original=await input.inputValue();await input.press('ControlOrMeta+Home');
    const pixels=await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL());
    await page.keyboard.insertText('Edited ');await input.press('ControlOrMeta+z');await input.press('ControlOrMeta+Home');
    await expect(input).toHaveValue(original);
    expect(await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL())).toBe(pixels);
    await page.keyboard.insertText('Edited ');
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
    const saved=info.outputPath(`${name}.docx`);await(await pending).saveAs(saved);
    const before=unzipSync(readFileSync(`public/fixtures/${name}.docx`)),after=unzipSync(readFileSync(saved));
    expectBodyEditParts(after,before);
    await reopenDocx(page,input,saved,'Edited '+original);expect(errors).toEqual([]);
  });
}

test('resolves inherited and stylesheet widths without changing zero/none strokes or leaking styles',async({page})=>{
  await page.goto('/playground.html');
  const result=await page.evaluate(async()=>{
    const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
    const source='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><style>.thin { stroke-width:.25px }</style><g stroke="black" stroke-width=".5"><rect class="thin" width="20" height="20"/><rect width="20" height="20"/><rect stroke-width="0" width="20" height="20"/><rect stroke="none" stroke-width=".25" width="20" height="20"/><rect vector-effect="non-scaling-stroke" width="20" height="20"/></g></svg>';
    const xml=new DOMParser().parseFromString(source,'image/svg+xml'),count=document.body.children.length;
    const root=nativeSvgStrokes(xml.documentElement,{width:120,height:80});
    return {styles:[...root.querySelectorAll('rect')].map(n=>n.style.strokeWidth),countSame:count===document.body.children.length};
  });
  result.styles.slice(0,2).forEach(width=>expect(Number(width)).toBeCloseTo(7/6,4));
  expect(result.styles.slice(2)).toEqual(['','','']);expect(result.countSame).toBe(true);
});
