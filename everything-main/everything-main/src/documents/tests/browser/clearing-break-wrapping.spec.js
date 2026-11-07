import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {unzipSync} from 'fflate';
const root='tests/fixtures/clearing-break-wrapping/';
const scopes=['body','header','footer','boundary','boundary-legacy','edge-none','edge-none-legacy'];
const native={tolerancePt:.2,scopes:Object.fromEntries(scopes.map(scope=>[scope,JSON.parse(readFileSync(root+scope+'-native.json','utf8'))]))};
const hash=b=>createHash('sha256').update(b).digest('hex');
test.setTimeout(180000);

test('native coordinates replay directly from preserved Unicode GDI records',()=>{
  for(const reference of Object.values(native.scopes))for(const page of reference.pages){
    const data=gunzipSync(readFileSync(root+page.file));expect(hash(data)).toBe(page.sha256);
    const lines=[],pictures=[];
    for(let offset=0;offset<data.length;){
      const kind=data.readUInt32LE(offset),size=data.readUInt32LE(offset+4);
      expect(size).toBeGreaterThanOrEqual(8);expect(offset+size).toBeLessThanOrEqual(data.length);
      const record=data.subarray(offset,offset+size);
      if(kind===9)expect([record.readInt32LE(8),record.readInt32LE(12)]).toEqual([5100,6600]);
      if(kind===10)expect([record.readInt32LE(8),record.readInt32LE(12)]).toEqual([0,0]);
      expect([11,12,35,36]).not.toContain(kind);
      if(kind===84){
        const count=record.readUInt32LE(44),start=record.readUInt32LE(48),text=record.subarray(start,start+count*2).toString('utf16le').trim();
        expect(record.readUInt32LE(52)).toBe(4);
        if(text)lines.push({text,xPt:record.readInt32LE(36)*.12,baselinePt:record.readInt32LE(40)*.12});
      }
      if(kind===81)pictures.push({xPt:record.readInt32LE(24)*.12,yPt:record.readInt32LE(28)*.12,widthPt:record.readInt32LE(72)*.12,heightPt:record.readInt32LE(76)*.12});
      offset+=size;
    }
    expect(lines).toEqual(page.lines);expect(pictures).toEqual(page.pictures);
  }

});

for(const scope of scopes)test(`${scope}: native wrapping, source preservation, text editing and round trip`,async({page},info)=>{
  const source=readFileSync(root+scope+'.docx'),reference=native.scopes[scope];
  expect(hash(source)).toBe(reference.sourceSha256);
  await page.goto('/playground.html');
  const actual=await page.evaluate(async({bytes,scope})=>{
    const {openCanvasDocument}=await import('/src/engine/open-document.js');
    const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
    const {fontAvailable,checkFontAvailability}=await import('/src/engine/font-availability.js');
    await checkFontAvailability('Arial');if(!fontAvailable('Arial'))throw Error('Control requires installed Arial through ordinary CSS.');
    const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
    const host=document.createElement('div');host.id='clearing-wrapping-probe';document.body.append(host);
    const errors=[];window.wrapPkg=pkg;window.wrapEditor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
    const editor=window.wrapEditor;
    const lines=[...editor.layout.lines,...editor.storyLayout.lines].flatMap(l=>(l.wrapSegments||[l]).map(p=>({page:l.page,text:p.fragments.filter(f=>!f.image).map(f=>f.text).join('').trim(),xPt:p.fragments.find(f=>!f.image)?.x*.75,baselinePt:l.baseline*.75}))).filter(l=>l.text);
    const pictures=[...editor.layout.floatingObjects,...editor.storyLayout.floatingObjects].map(f=>({page:f.page,xPt:f.x*.75,yPt:f.y*.75,widthPt:f.width*.75,heightPt:f.height*.75}));
    const selected=editor.editStory(!['header','footer'].includes(scope)?null:`word/${scope}.xml`);
    return {readOnly:!!pkg.readOnly,lines,pictures,errors,selected,original:editor.model.text,exported:[...new Uint8Array(await (await editor.export(pkg)).arrayBuffer())]};
  },{bytes:[...source],scope});
  expect(actual.readOnly).toBe(false);expect(actual.errors).toEqual([]);expect(actual.selected).toBe(true);
  expect(unzipSync(new Uint8Array(actual.exported))).toEqual(unzipSync(source));
  for(const p of reference.pages){
    for(const expected of p.lines){
      const matches=actual.lines.filter(l=>l.page===p.page&&l.text===expected.text);expect(matches,expected.text).toHaveLength(1);
      for(const key of ['xPt','baselinePt'])expect(Math.abs(matches[0][key]-expected[key]),`${expected.text} ${key}`).toBeLessThanOrEqual(native.tolerancePt);
    }
    // EMF fallback image emission order does not identify source drawings.
    // Compare all frame coordinates in spatial order; XML preservation below
    // checks source drawing order independently.
    const spatial=(a,b)=>a.yPt-b.yPt||a.xPt-b.xPt;
    const pictures=actual.pictures.filter(f=>f.page===p.page).sort(spatial),expectedPictures=[...p.pictures].sort(spatial);
    expect(pictures).toHaveLength(expectedPictures.length);
    for(let i=0;i<pictures.length;i++)for(const key of ['xPt','yPt','widthPt','heightPt'])expect(Math.abs(pictures[i][key]-expectedPictures[i][key]),`picture ${i} ${key}`).toBeLessThanOrEqual(native.tolerancePt);
  }
  await page.evaluate(()=>{const e=window.wrapEditor;e.model.select(e.model.text.indexOf('SECOND 1'));e.focus();});
  await page.keyboard.insertText('EDIT ');
  const input=page.locator('#clearing-wrapping-probe textarea');await expect(input).toHaveValue(actual.original.replace('SECOND 1','EDIT SECOND 1').replace(/\v/g,'\n'));
  const edited=await page.evaluate(async()=>[...new Uint8Array(await (await window.wrapEditor.export(window.wrapPkg)).arrayBuffer())]);
  writeFileSync(info.outputPath('edited.docx'),Buffer.from(edited));
  const parts=unzipSync(source),changed=unzipSync(new Uint8Array(edited));
  for(const [name,value] of Object.entries(parts))if(name!==`word/${!['header','footer'].includes(scope)?'document':scope}.xml`)expect(changed[name],name).toEqual(value);
  const reopened=await page.evaluate(async({bytes,scope})=>{
    const {openCanvasDocument}=await import('/src/engine/open-document.js');const {pkg}=await openCanvasDocument(new Uint8Array(bytes));
    const paragraphs=!['header','footer'].includes(scope)?pkg.paragraphs:pkg.pageStories.stories[`word/${scope}.xml`].paragraphs;
    return {readOnly:!!pkg.readOnly,text:paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n')};
  },{bytes:edited,scope});
  expect(reopened.readOnly).toBe(false);expect(reopened.text).toBe(actual.original.replace('SECOND 1','EDIT SECOND 1'));
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(actual.original.replace(/\v/g,'\n'));
  const undo=await page.evaluate(async()=>[...new Uint8Array(await (await window.wrapEditor.export(window.wrapPkg)).arrayBuffer())]);
  expect(unzipSync(new Uint8Array(undo))).toEqual(parts);writeFileSync(info.outputPath('undo.docx'),Buffer.from(undo));
  await page.evaluate(()=>{window.wrapEditor.destroy();document.querySelector('#clearing-wrapping-probe').remove();});
});
