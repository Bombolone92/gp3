import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

const source='public/fixtures/justified-line-fit.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/justified-line-fit/reference.json','utf8'));
function cases(lines) {
 const result={};let key;
 for(const line of lines){const text=line.text.trimEnd();if(/^(Calibri|Arial), \d+pt, (left|both)$/.test(text)){key=text;result[key]=[];}else if(text)result[key].push(text);}
 return result;
}
const expected=cases(reference.pages.flat());
const compressed=['Calibri, 370pt, both','Arial, 370pt, both','Arial, 375pt, both'];

async function open(page) {
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync('tests/fixtures/justified-line-fit/native.pdf')).digest('hex')).toBe(reference.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^Calibri, 360pt, left/);await expect(input).toHaveJSProperty('readOnly',false);
 const available=await page.evaluate(async()=>{const {fontAvailable}=await import('/src/engine/font-availability.js');return ['Calibri','Arial'].every(fontAvailable);});
 test.skip(!available,'Requires installed Calibri and Arial; proprietary fonts are not redistributed.');
 return input;
}
async function actual(page) {
 return cases(await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const pkg=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(pkg);const ctx=document.createElement('canvas').getContext('2d');
  return layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables).lines.map(l=>({text:l.fragments.map(f=>f.text).join('')}));
 },readFileSync(source).toString('base64')));
}

test('retains the paired native control, ordinary line breaks and editable package contents',async({page},info)=>{
 const input=await open(page),observed=await actual(page);
 writeFileSync(info.outputPath('actual.json'),JSON.stringify(observed,null,2));
 expect(Object.keys(observed)).toEqual(Object.keys(expected));
 for(const key of Object.keys(expected).filter(k=>!compressed.includes(k)))expect(observed[key],key).toEqual(expected[key]);
 for(const [i,canvas] of (await page.locator('canvas.canvas-page').all()).entries())writeFileSync(info.outputPath(`page-${i+1}.png`),Buffer.from(await canvas.evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'EDIT '+original);await expect(page.locator('#playground-error')).toBeEmpty();
});

for(const key of compressed)test(`native compressed-space line fitting: ${key}`,async({page})=>{
 await open(page);const observed=await actual(page);
 expect(observed[key]).toEqual(expected[key]);
});
