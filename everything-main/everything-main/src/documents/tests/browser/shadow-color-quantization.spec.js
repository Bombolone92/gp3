import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {downloadDocx} from './helpers/editor-tools.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/shadow-color-quantization/',source=root+'source.docx';
const ref=JSON.parse(readFileSync(root+'reference.json'));
// Fixed before this run from the retained September 29 comparison. Never classify
// failures dynamically: a new mismatch must fail the ordinary regression test.
const unresolved=new Set([
 'color-8040C0-alpha-80000','color-8040C0-alpha-90000',
 'color-FFFFFF-alpha-60000','color-FFFFFF-alpha-90000',
 'color-4080C0-alpha-80000','color-4080C0-alpha-90000',
]);
async function open(page){
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^color-8040C0-alpha-10000/);await expect(input).toBeEditable();
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.cases.length);
 return input;
}
test('opacity controls preserve their package through editing, undo and reopening',async({page},info)=>{
 test.setTimeout(120000);
 const input=await open(page),original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const pending=page.waitForEvent('download');await downloadDocx(page);const p=info.outputPath(name+'.docx');await(await pending).saveAs(p);return p;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await save('edited'),after=unzipSync(readFileSync(edited));
 expectBodyEditParts(after,parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
 expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toBeEditable();
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.cases.length);
});
async function comparisons(page,info){
 await open(page);
 const actual=await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>{
  const scale=c.width/612;return [...c.getContext('2d').getImageData(Math.round(324*scale),Math.round(136*scale),1,1).data].slice(0,3);
 }));
 const rows=ref.cases.map((r,i)=>({name:r.name,native:r.gdiRgb,actual:actual[i]}));
 const output=info.outputPath('native-comparisons.json');
 writeFileSync(output,JSON.stringify(rows,null,2));
 await info.attach('native-comparisons',{path:output,contentType:'application/json'});
 return rows;
}

test('previously matching shadow opacity composites remain exact',async({page},info)=>{
 const rows=(await comparisons(page,info)).filter(r=>!unresolved.has(r.name));
 expect(rows).toHaveLength(32);
 for(const r of rows)expect(r.actual,r.name).toEqual(r.native);
});

test('six unresolved shadow opacity composites match exact native colors',async({page},info)=>{
 const rows=(await comparisons(page,info)).filter(r=>unresolved.has(r.name));
 expect(rows).toHaveLength(6);
 test.fail(true,'Native shadow bitmap channel quantization is not implemented; keep exact composites visible.');
 expect(rows.map(r=>r.actual)).toEqual(rows.map(r=>r.native));
});
