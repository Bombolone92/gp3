import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {winningTableBorder} from '../src/engine/table-border-layout.js';
let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('public/fixtures/nil-border-conflicts.docx');
const model=pkg=>new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
const measure=(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize,descent:style.fontSize/3});
function check(doc){
  const result=layoutDocument(doc.paragraphs,measure,pageGeometry(doc.pageSettings),doc.numbering,doc.tables);
  expect(doc.tables).toHaveLength(12);
  for(const [index,table] of doc.tables.entries()){
    const shared=result.tableBorders.filter(s=>s.tableId===table.id&&s.cellIds.length===2);
    expect(shared).toHaveLength(1);expect(shared[0].horizontal).toBe(index<6);
    if(index%6===2)expect(shared[0].guide).toBe(true);
    else {expect(shared[0].guide).toBe(false);expect(shared[0].border).toMatchObject({style:'single',size:24,color:index%6<2?'00AA00':'0000FF'});}
  }
}
it('matches the twelve independently measured native reference conflicts in both orientations',async()=>check(model(await DocxPackage.open(source))));
it('preserves nil declarations and the rendered opposing edges through text editing and undo',async()=>{
  const pkg=await DocxPackage.open(source),doc=model(pkg);const at=doc.text.indexOf('First')+5;doc.select(at);doc.replace('X');
  const bytes=new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
  const reopened=await DocxPackage.open(bytes);check(model(reopened));expect(model(reopened).text).toBe(doc.text);
  const parts=unzipSync(bytes);for(const [name,data] of Object.entries(pkg.parts))if(name!=='word/document.xml')expect(Buffer.from(parts[name]).equals(Buffer.from(data)),name).toBe(true);
  doc.undo();check(doc);const restored=new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
  const restoredParts=unzipSync(restored);for(const [name,data] of Object.entries(pkg.parts))expect(Buffer.from(restoredParts[name]).equals(Buffer.from(data)),name).toBe(true);
});
it.each(['nil','none'])('lets a visible opposing edge win over %s regardless of order',style=>{
  const empty={border:{style,size:24},order:0},visible={border:{style:'single',size:8,color:'000000'},background:'#FFFFFF',order:1};
  expect(winningTableBorder(empty,visible)).toBe(visible);expect(winningTableBorder(visible,empty)).toBe(visible);
});
