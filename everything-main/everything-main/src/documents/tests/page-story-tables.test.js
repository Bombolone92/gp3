import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {layoutPageStories} from '../src/engine/page-story-layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const source=readFileSync('public/fixtures/page-story-tables.docx');let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const measure=text=>({width:text.length*7,ascent:12,descent:4});
function render(d,stories){const body=layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables,stories);return {body,stories:layoutPageStories(body,stories,[d.pageSettings],measure,d.numbering,{styles:d.styles})};}
it('keeps story tables and relationships separate from body editing and repeats their geometry on each page',async()=>{
 const p=await DocxPackage.open(source),r=render(p,p.pageStories);expect(p.tables).toEqual([]);expect(p.paragraphs).toHaveLength(2);
 expect(p.pageStories.stories['word/header.xml'].tables).toHaveLength(1);expect(p.pageStories.stories['word/footer.xml'].tables).toHaveLength(2);
 expect(r.body.cells).toHaveLength(0);expect(r.stories.cells).toHaveLength(14);expect(r.stories.unsupported).toEqual([]);
 expect(r.stories.lines.flatMap(l=>l.fragments).filter(f=>f.image)).toHaveLength(2);
 expect(r.stories.lines.map(l=>l.fragments.map(f=>f.text).join('')).filter(t=>t.startsWith('Page '))).toEqual(['Page 1','Page 2']);
 for(const c of r.stories.cells){expect(c.pageStory).toMatch(/^word\/(header|footer)\.xml$/);expect(c.y).toBeGreaterThan(0);if(c.pageStory.includes('footer'))expect(c.y).toBeGreaterThan(500);}
 for(const b of r.stories.tableBorders.filter(b=>b.pageStory.includes('footer')))expect(b.y).toBeGreaterThan(500);
});
it('preserves all story parts through body repagination, export, reopen and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets),parts=unzipSync(source);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(parts);const before=render(d,p.pageStories);d.select(0);d.replace('Added body words '.repeat(150));
 const changed=render(d,p.pageStories);expect(changed.body.pageCount).toBeGreaterThan(2);expect(changed.stories.cells).toHaveLength(changed.body.pageCount*7);
 const bytes=await save(),exported=unzipSync(bytes);for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(exported[name],name).toEqual(parts[name]);
 const reopened=await DocxPackage.open(bytes);expect(render(reopened,reopened.pageStories).stories.lines.map(l=>l.fragments.map(f=>f.text).join(''))).toEqual(changed.stories.lines.map(l=>l.fragments.map(f=>f.text).join('')));
 d.undo();expect(unzipSync(await save())).toEqual(parts);expect(render(d,p.pageStories)).toEqual(before);
});
it('does not assign story table bookmarks to the body identity scope',async()=>{
 const parts=unzipSync(source);parts['word/header.xml']=strToU8(strFromU8(parts['word/header.xml']).replace('<w:tblPr>','<w:bookmarkStart w:id="0" w:name="StoryOnly"/><w:bookmarkEnd w:id="0"/><w:tblPr>'));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/bookmark scope/);
 const preview=await DocxPackage.open(zipSync(parts),{bestEffort:true});expect(preview.readOnly).toBe(true);expect(preview.tables).toEqual([]);expect(preview.paragraphs).toHaveLength(2);
});
