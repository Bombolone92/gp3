import {it,expect,beforeAll,afterAll} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraph} from '../src/engine/model.js';
import {layoutPageStories} from '../src/engine/page-story-layout.js';
import {prepareShapeAutofit,fittedDrawingParagraphs} from '../src/engine/shape-autofit.js';
import {layoutDocument,imageAtPoint} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('tests/fixtures/shape-autofit/spAutoFit.docx'),A='http://schemas.openxmlformats.org/drawingml/2006/main';
const measure=(text,style)=>({width:text.length*style.fontSize*.6,ascent:style.fontSize,descent:style.fontSize*.2});
it('grows/shrinks standalone and scaled group frames consistently without changing source data',async()=>{
 const p=await DocxPackage.open(source),original=JSON.stringify(p.paragraphs),assets=JSON.stringify(p.assets),f=prepareShapeAutofit(p.assets,measure);
 expect(JSON.stringify(p.paragraphs)).toBe(original);expect(JSON.stringify(p.assets)).toBe(assets);expect(f.drawingLayouts.size).toBe(12);
 const sizes=[...f.drawingLayouts.values()];for(const fit of sizes){expect(fit.width).toBe(120*12700);expect(fit.height).toBe(sizes[0].height);}
 expect(sizes[0].height).toBeGreaterThan(sizes[0].sourceHeight);expect(sizes[3].height).toBeLessThan(sizes[3].sourceHeight);
 const again=prepareShapeAutofit(f.assets,measure);expect(again.assets).toBe(f.assets);expect([...again.drawingLayouts]).toEqual([...f.drawingLayouts]);
 const l=layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables,undefined,{drawingLayouts:f.drawingLayouts});
 const line=l.lines.find(l=>l.fragments.some(f=>f.image)),frag=line.fragments.find(f=>f.image);
 expect(imageAtPoint(l,line.page,frag.x+2,line.baseline-frag.ascent+2)?.image.height).toBe(sizes[0].height);
 expect(JSON.stringify(p.paragraphs)).toBe(original);
});
it('keeps documents without autofit on their existing geometry path',async()=>{
 const p=await DocxPackage.open(readFileSync('tests/fixtures/shape-autofit/noAutofit.docx')),f=prepareShapeAutofit(p.assets,measure);
 expect(f.assets).toBe(p.assets);expect(f.drawingLayouts).toBeUndefined();expect(fittedDrawingParagraphs(p.paragraphs,f.drawingLayouts)).toBe(p.paragraphs);
});
it('uses the same fitted frame for header painting and body clearance',async()=>{
 const p=await DocxPackage.open(source),f=prepareShapeAutofit(p.assets,measure),drawing=p.paragraphs.find(p=>p.runs.some(r=>r.image));
 const definition={sections:[{header:{default:'header'},footer:{}}],stories:{header:{paragraphs:[drawing],tables:[]}}},body=[paragraph('Body')],g=pageGeometry(p.pageSettings);
 const plain=layoutDocument(body,measure,g,p.numbering,[],definition),fitted=layoutDocument(body,measure,g,p.numbering,[],definition,{drawingLayouts:f.drawingLayouts});
 expect(fitted.lines[0].y).toBeGreaterThan(plain.lines[0].y);
 const story=layoutPageStories(fitted,definition,[p.pageSettings],measure,p.numbering,{drawingLayouts:f.drawingLayouts});
 const image=story.lines.flatMap(l=>l.fragments).find(f=>f.image).image;
 expect(image.height).toBe(f.drawingLayouts.get(image.assetId).height);expect(drawing.runs.find(r=>r.image).image.height).not.toBe(image.height);
});
it('guards page-dependent and relative-size combinations instead of using a stale fitted frame',async()=>{
 const p=await DocxPackage.open(source),assets=structuredClone(p.assets),asset=Object.values(assets).find(a=>a.scene?.text?.autoFit);
 asset.scene.text.paragraphs[0].runs[0].field={type:'PAGE',cachedText:'1'};
 expect(()=>prepareShapeAutofit(assets,measure)).toThrow(/page-dependent/);
 const f=prepareShapeAutofit(p.assets,measure),ps=structuredClone(p.paragraphs),image=ps.flatMap(p=>p.runs).find(r=>r.image).image;
 image.anchor={relativeSize:{height:{relativeFrom:'page',percent:50000}}};expect(()=>fittedDrawingParagraphs(ps,f.drawingLayouts)).toThrow(/relative page sizing/);
});
it('retains original drawing XML through unrelated edits, reopening and exact undo',async()=>{
 const p=await DocxPackage.open(source),f=prepareShapeAutofit(p.assets,measure),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,f.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 const same=(b)=>{const out=unzipSync(b);for(const [n,bytes]of Object.entries(p.parts))expect(Buffer.from(out[n]).equals(Buffer.from(bytes)),n).toBe(true);};
 same(await save());d.select(0);d.replace('Edited ');const edited=await save(),r=await DocxPackage.open(edited);expect(new TextDocument(r.paragraphs).text).toBe(d.text);
 const xml=b=>new DOMParser().parseFromString(strFromU8(unzipSync(b)['word/document.xml']),'application/xml');
 const drawings=b=>[...xml(b).getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','drawing')].map(n=>new XMLSerializer().serializeToString(n));
 expect(drawings(edited)).toEqual(drawings(source));d.undo();same(await save());
});
it.each(['conflict','duplicate','attribute','nested','text','normAutofit'])('rejects malformed or unsupported autofit: %s',async kind=>{
 const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml'),fit=xml.getElementsByTagNameNS(A,'spAutoFit')[0];
 if(kind==='conflict')fit.parentNode.append(xml.createElementNS(A,'a:noAutofit'));
 if(kind==='duplicate')fit.parentNode.append(fit.cloneNode(true));
 if(kind==='attribute')fit.setAttribute('val','1');
 if(kind==='nested')fit.append(xml.createElementNS(A,'a:future'));
 if(kind==='text')fit.textContent='invalid';
 if(kind==='normAutofit')fit.replaceWith(xml.createElementNS(A,'a:normAutofit'));
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/grouped drawings/);
});
