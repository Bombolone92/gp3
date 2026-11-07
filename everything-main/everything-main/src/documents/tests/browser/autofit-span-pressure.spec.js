import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/autofit-span-pressure',ref=JSON.parse(readFileSync(`${folder}/reference.json`));

for (const name of ['legacy', 'modern', 'series', 'content', 'wide']) test(`matches native crossing-span boundaries: ${name}`, async ({page}, info) => {
  const extra = name === 'content' || name === 'wide';
  const sourceFolder = extra ? 'tests/fixtures/autofit-crossing-content' : folder;
  const reference = extra ? JSON.parse(readFileSync(`${sourceFolder}/${name === 'wide' ? 'wide-reference' : 'reference'}.json`)) : ref[name];
  const cellReference = extra ? JSON.parse(readFileSync(`${sourceFolder}/${name === 'wide' ? 'wide' : 'control'}-cell-widths.json`)) : null;
  if (cellReference) expect(createHash('sha256').update(readFileSync(`${sourceFolder}/${cellReference.source}`)).digest('hex')).toBe(cellReference.sha256);
  for (const [file, hash] of Object.entries(reference.hashes)) expect(createHash('sha256').update(readFileSync(`${sourceFolder}/${file}`)).digest('hex')).toBe(hash);
  await page.goto('/playground.html');
  const installed = await page.evaluate(async () => { try { await new FontFace('Crossing span reference', 'local("Arial")').load(); return true; } catch { return false; } });
  test.skip(!installed, 'Native reference requires Arial.');
  const actual = await page.evaluate(async bytes => {
    const {DocxPackage} = await import('/src/engine/docx.js');
    const {layoutDocument} = await import('/src/engine/layout.js');
    const {pageGeometry} = await import('/src/engine/page-settings.js');
    const {loadCanvasFonts, measureCanvasText} = await import('/src/engine/canvas-text.js');
    const p = await DocxPackage.open(Uint8Array.from(bytes));
    await loadCanvasFonts(p);
    const ctx = document.createElement('canvas').getContext('2d');
    const l = layoutDocument(p.paragraphs, (t,s) => measureCanvasText(ctx,t,s), pageGeometry(p.pageSettings), p.numbering, p.tables);
    return {pages: l.pages.length, tables: p.tables.map(t => {
      const rows = t.rows.filter(r => r.cells.length === 3 || r.cells.length === 2);
      const cells = [...rows.find(r => r.cells.length === 3).cells, ...(rows.find(r => r.cells.length === 2)?.cells || [])];
      return cells.map(c => {
        const b = l.cells.find(b => b.id === c.id);
        return {x: b.x * .75, width: b.width * .75, page: b.page};
      });
    })};
  }, [...readFileSync(`${sourceFolder}/${name === 'content' ? 'control' : name}.docx`)]);
  const native = reference.pages, differences = [];
  expect(actual.pages).toBe(native.length);
  expect(actual.tables).toHaveLength(native.length);
  for (const [i, cells] of actual.tables.entries()) {
    const keys = ['left', 'spacer', 'right', 'bottomLeft', 'bottomRight'].filter(k => native[i][k]);
    expect(cells).toHaveLength(keys.length);
    for (const [j, c] of cells.entries()) {
      expect(c.page).toBe(i);
      for (const property of ['x', 'width']) {
        expect(Number.isFinite(c[property])).toBe(true);
        const delta = c[property] - native[i][keys[j]][property];
        const matchedPages = {legacy:[1], modern:[1], series:[5,6], content:[7,8,12]};
        if (matchedPages[name]?.includes(i)) expect(Math.abs(delta), `${name}/${i + 1}/${keys[j]}/${property}`).toBeLessThan(.2);
        if (Math.abs(delta) >= .2) differences.push({page: i + 1, cell: keys[j], property, actual: c[property], native: native[i][keys[j]][property], delta});
      }
    }
  }
  const cellWidthDifferences = [];
  if (cellReference) {
    expect(cellReference.tables).toHaveLength(actual.tables.length);
    for (const [i, cells] of actual.tables.entries()) {
      const nativeCells = cellReference.tables[i];
      // The fixture reverses row order in four cases. Match the three-cell
      // upper pattern first, as above, rather than assuming document order.
      const rows = Map.groupBy(nativeCells, c => c.row);
      const ordered = [3, 2].flatMap(count => [...rows.values()].find(row => row.length === count) || []);
      expect(ordered).toHaveLength(cells.length);
      for (const [j, cell] of cells.entries()) {
        const delta = cell.width - ordered[j].width;
        if (Math.abs(delta) >= .2) cellWidthDifferences.push({page:i + 1, cell:j, actual:cell.width, native:ordered[j].width, delta});
      }
    }
  }
  writeFileSync(info.outputPath('native-boundary-differences.json'), JSON.stringify({actual, differences, cellWidthDifferences}, null, 2));
  expect.soft(cellWidthDifferences, 'Direct native cell widths, independent of PDF painting').toEqual([]);
  expect(differences).toEqual([]);
});
test('matches native pressure outside a merged span through editing, undo and reopening',async({page},info)=>{
  await page.goto('/playground.html');
  const installed=await page.evaluate(async()=>{try{await new FontFace('Reference check','local("Arial")').load();return true;}catch{return false;}});
  test.skip(!installed,'Native reference requires Arial.');
  await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/modern.docx`);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Case 1/);await expect(input).toHaveJSProperty('readOnly',false);
  const actual=await page.evaluate(async bytes=>{
    const{DocxPackage}=await import('/src/engine/docx.js');const{layoutDocument}=await import('/src/engine/layout.js');const{pageGeometry}=await import('/src/engine/page-settings.js');const{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
    const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
    const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
    return p.tables.map(t=>t.rows.find(r=>r.cells.length===3).cells.map(c=>{const b=l.cells.find(b=>b.id===c.id);return{x:b.x*.75,width:b.width*.75,page:b.page};}));
  },readFileSync(`${folder}/modern.docx`).toString('base64'));
  for(const i of [0,1,2])for(const[j,c]of actual[i].entries()){
    expect(c.page).toBe(i);for(const key of ['x','width'])expect(Math.abs(c[key]-ref.modern.pages[i][['left','spacer','right'][j]][key]),`${i}/${j}/${key}`).toBeLessThan(.2);
  }
  await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
  for(let i=0;i<6;i++)writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath('edited.docx');await(await pending).saveAs(path);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await reopenDocx(page,input,path,'Edited '+original);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(6);await expect(page.locator('#playground-error')).toBeEmpty();
});
