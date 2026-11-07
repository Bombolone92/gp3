import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {zipSync,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {activePageStoryPaths} from '../src/engine/page-stories.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const source=mode=>readFileSync(`tests/fixtures/inactive-stories/${mode}.docx`);
it('edits body text while preserving disabled unsupported stories and exact undo',async()=>{
 const pkg=await DocxPackage.open(source('disabled'));
 expect([...activePageStoryPaths(pkg.pageStories)]).toEqual(['word/header-default.xml']);
 expect(pkg.pageStories.stories['word/header-first.xml'].paragraphs).toEqual([]);
 const model=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 model.select(0);model.replace('Edited ');
 const save=async()=>new Uint8Array(await pkg.export(model.paragraphs,model.pageSettings,model.numbering,model.styles).arrayBuffer());
 const reopened=await DocxPackage.open(await save());
 expect(reopened.paragraphs[0].runs.map(r=>r.text).join('')).toContain('Edited ');
 for(const [name,bytes]of Object.entries(pkg.parts))if(name!=='word/document.xml')expect(reopened.parts[name]).toEqual(bytes);
 model.undo();expect((await DocxPackage.open(await save())).parts).toEqual(pkg.parts);
});
it.each(['first','even'])('still rejects unsupported content when %s stories are enabled',async mode=>{
 await expect(DocxPackage.open(source(mode))).rejects.toThrow(/unsupported page field instruction/);
 expect((await DocxPackage.open(source(mode),{bestEffort:true})).readOnly).toBe(true);
});
it('validates a disabled first story when a later section enables its inherited reference',async()=>{
 const pkg=await DocxPackage.open(source('disabled'));
 const parts={...pkg.parts};
 let xml=new TextDecoder().decode(parts['word/document.xml']);
 const sect=xml.match(/<w:sectPr>[\s\S]*?<\/w:sectPr>/)[0];
 xml=xml.replace(sect,`<w:p><w:pPr>${sect}</w:pPr></w:p><w:p><w:r><w:t>Later section</w:t></w:r></w:p><w:sectPr><w:titlePg/></w:sectPr>`);
 parts['word/document.xml']=strToU8(xml);
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/unsupported page field instruction/);
});
it('validates a shared part when another enabled reference uses it',async()=>{
 const pkg=await DocxPackage.open(source('disabled')),parts={...pkg.parts};
 parts['word/_rels/document.xml.rels']=strToU8(new TextDecoder().decode(parts['word/_rels/document.xml.rels']).replace('Target="header-default.xml"','Target="header-even.xml"'));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/unsupported page field instruction/);
});
