import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {JSDOM} from 'jsdom';

const base='tests/fixtures/print-story-margin-phase/';
const source=readFileSync(base+'control.docx');
const cases=JSON.parse(readFileSync(base+'cases.json'));
const raw=JSON.parse(readFileSync(base+'native-metafile-rectangles.json'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const blue=page=>page.fills.filter(f=>f.colorRef===0x917f6d);
const far=page=>Math.max(...blue(page).map(f=>f.destination[1]+f.destination[3]));

it('binds native pages to independently authored section and row declarations',()=>{
 expect(sha(source)).toBe(raw.sourceSha256);
 expect(sha(readFileSync(base+'cases.json'))).toBe(raw.casesSha256);
 expect(raw.sourceUnchanged).toBe(true);expect(raw.pages).toHaveLength(8);
 const dom=new JSDOM(''),xml=new dom.window.DOMParser().parseFromString(strFromU8(unzipSync(source)['word/document.xml']),'application/xml');
 try{
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const nodes=(root,name)=>[...root.getElementsByTagNameNS(ns,name)];
  const attr=(node,name)=>Number(node.getAttributeNS(ns,name));
  const sections=nodes(xml,'sectPr'),tables=nodes(xml,'tbl');
  expect(sections).toHaveLength(8);expect(tables).toHaveLength(8);
  for(const [i,c]of cases.entries()){
   const margin=nodes(sections[i],'pgMar')[0],size=nodes(sections[i],'pgSz')[0];
   expect(attr(margin,'top')).toBe(c.topTwips);
   for(const key of ['header','footer'])expect(attr(margin,key)).toBe(c.storyMarginTwips);
   expect(attr(size,'w')/20).toBe(c.pageWidthPt);expect(attr(size,'h')/20).toBe(c.pageHeightPt);
   expect(attr(nodes(tables[i],'trHeight')[0],'val')).toBe(c.heightTwips);
   expect(blue(raw.pages[i])).toHaveLength(12);
   expect(blue(raw.pages[i]).every(f=>f.clips.length===0)).toBe(true);
   expect(raw.pages[i].windowExtent).toEqual([5100,6600]);
   expect(raw.pages[i].sha256).toMatch(/^[0-9a-f]{64}$/);
  }
 }finally{dom.window.close();}
});

it('rejects story margins as the cause of the low-origin float rounding holdout',()=>{
 expect(raw.pages.map(far)).toEqual([476,476,478,478,2032,2032,2034,2034]);
 for(let i=0;i<8;i+=2){
  expect(cases[i+1]).toEqual({...cases[i],index:i+1,page:i+1,storyMarginTwips:720});
  expect(cases[i].storyMarginTwips).toBe(0);
  expect(blue(raw.pages[i+1])).toEqual(blue(raw.pages[i]));
 }
 for(const i of [2,3]){
  expect(Math.round(Math.fround((cases[i].topTwips+cases[i].heightTwips+20)/20)/.12)).toBe(477);
  expect(far(raw.pages[i])).toBe(478);
 }
});
