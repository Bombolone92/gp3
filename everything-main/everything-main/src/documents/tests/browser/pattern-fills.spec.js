import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/pattern-fills/',ref=JSON.parse(readFileSync(root+'reference.json'));
for(const p of ref.pages)for(const key of ['sample96','axisAlignedSample96'])if(p[key])p[key]=[...Buffer.from(p[key],'hex')];
test('renders native pattern presets and retains them through body edits',async({page},info)=>{
 test.setTimeout(180000);
 for(const[name,hash]of [['controls.docx',ref.sourceSha256],['controls-native.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+'controls.docx');
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^pct5/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(74);
 const samples=await page.locator('canvas.canvas-page').evaluateAll(canvases=>canvases.map(c=>{
  const pixels=c.getContext('2d').getImageData(232,192,8,8).data;return [...pixels].filter((_,i)=>i%4!==3);
 }));
 const ellipseCorner=await page.locator('canvas.canvas-page').nth(66).evaluate(c=>[...c.getContext('2d').getImageData(122,122,1,1).data]);
 expect(ellipseCorner).toEqual([255,255,255,255]);
 const differences=samples.map((sample,i)=>({name:ref.pages[i].name,max:Math.max(...sample.map((v,c)=>Math.abs(v-(ref.pages[i].axisAlignedSample96||ref.pages[i].sample96)[c]))),rawNativeMax:Math.max(...sample.map((v,c)=>Math.abs(v-ref.pages[i].sample96[c])))}));
 writeFileSync(info.outputPath('native-differences.json'),JSON.stringify(differences,null,2));
 writeFileSync(info.outputPath('samples.json'),JSON.stringify(samples));
 // Preserve the inherited-group phase diagnostic without certifying it.
 // Rotated controls additionally retain the raw PDFium samples: its tile
 // rounding artifact disappears when the native reference's <1e-7 skew is zeroed explicitly.
 for(const[i,d]of differences.entries())if(!ref.pages[i].inherited)expect(d.max,d.name).toBeLessThanOrEqual(2);
 for(const i of [0,23,28,58,59,61,62,65,66,67])writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue(),parts=unzipSync(readFileSync(root+'controls.docx'));
 const save=async name=>{const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await wait).saveAs(path);return path;};
 const same=(path,edited=false)=>{const out=unzipSync(readFileSync(path));if(edited)return expectBodyEditParts(out,parts);expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const[n,b]of Object.entries(parts))if(!edited||n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 same(await save('noedit'));await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited\n');const edited=await save('edited');same(edited,true);
 // Moving the first drawing down a paragraph must retain its page tile phase.
 const moved=await page.locator('canvas.canvas-page').first().evaluate(c=>[...c.getContext('2d').getImageData(232,192,8,8).data].filter((_,i)=>i%4!==3));
 expect(moved).toEqual(samples[0]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);same(await save('undo'));await reopenDocx(page,input,edited,'Edited\n'+original);expect(errors).toEqual([]);
});
