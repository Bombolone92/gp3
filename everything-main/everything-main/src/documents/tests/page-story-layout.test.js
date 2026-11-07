import { it, expect } from 'vitest';
import { layoutDocument } from '../src/engine/layout.js';
import { layoutPageStories } from '../src/engine/page-story-layout.js';
import { paragraph } from '../src/engine/model.js';
import { DEFAULT_PAGE_SETTINGS, pageGeometry } from '../src/engine/page-settings.js';
import { paragraphBackgrounds } from '../src/engine/paragraph-backgrounds.js';

const measure = text => ({width:text.length*8,ascent:12,descent:4});
const settings = {...DEFAULT_PAGE_SETTINGS};
const story = (type, text='99') => ({paragraphs:[paragraph('', {runs:[{text:'\ufffc',field:{type,cachedText:text}}]})]});
const definition = {evenAndOdd:false,sections:[{header:{},footer:{default:'footer'}}],stories:{footer:story('NUMPAGES')}};
function layout(paragraphs, def=definition) {
  const body = layoutDocument(paragraphs,measure,pageGeometry(settings));
  return {body,stories:layoutPageStories(body,def,[settings],measure)};
}
it('recomputes page counts after body reflow without replacing retained field results',()=>{
  const before=structuredClone(definition), one=[paragraph('First')];
  expect(layout(one).stories.lines[0].fragments[0].text).toBe('1');
  const two=layout([...one,paragraph('Second',{format:{pageBreakBefore:true}})]);
  expect(two.body.pageCount).toBe(2);
  expect(two.stories.lines.map(line=>line.fragments[0].text)).toEqual(['2','2']);
  expect(definition).toEqual(before);
});
it('uses section page counts and inherits the selected footer independently',()=>{
  const paragraphs=[paragraph('First',{sectionEnd:settings}),paragraph('Second'),paragraph('Third',{format:{pageBreakBefore:true}})];
  const def={...definition,sections:[definition.sections[0],definition.sections[0]],stories:{footer:story('SECTIONPAGES')}};
  const body=layoutDocument(paragraphs,measure,pageGeometry(settings));
  expect(body.pageSections).toEqual([0,1,1]);
  const placed=layoutPageStories(body,def,[settings,settings],measure);
  expect(placed.lines.map(line=>line.fragments[0].text)).toEqual(['1','2','2']);
});
it('allows footer paragraph backgrounds inside the bottom page margin',()=>{
  const def=structuredClone(definition);
  def.stories.footer.paragraphs[0].format={shading:'#FFFF00'};
  const {body,stories}=layout([paragraph('Body')],def);
  const line=stories.lines[0];
  // Use a physical shading band to exercise clipping independently of styles.
  line.paragraphBackground={x:96,width:624,before:0,after:0,value:'#FFFF00'};
  const {rect}=paragraphBackgrounds([line],body.page,[]).get(line);
  expect(rect.y).toBeGreaterThan(body.page.height-body.page.bottom);
  expect(rect.height).toBeGreaterThan(0);
});
it('retains the body preview when an oversized story cannot yet be laid out',()=>{
  const def=structuredClone(definition);
  def.stories.footer.paragraphs.push(paragraph('Second footer page',{format:{pageBreakBefore:true}}));
  const body=layoutDocument([paragraph('Body')],measure,pageGeometry(settings)),before=structuredClone(body);
  expect(()=>layoutPageStories(body,def,[settings],measure)).toThrow(/taller than a page/);
  const result=layoutPageStories(body,def,[settings],measure,undefined,{bestEffort:true});
  expect(result.unsupported).toHaveLength(1);
  expect(result.lines).toEqual([]);
  expect(body).toEqual(before);
});

it('resolves restricted header drawings on each repeated page without mutating their source offsets',()=>{
 const image=(id,x,order)=>({id,assetId:id,alt:'Collision control',width:914400,height:914400,
  anchor:{horizontal:'page',vertical:'page',x:x*12700,y:144*12700,wrap:'none',behind:true,allowOverlap:false,order}});
 const red=image('red',144,2),blue=image('blue',180,1);
 const def={evenAndOdd:false,sections:[{header:{default:'header'},footer:{}}],stories:{header:{paragraphs:[paragraph('',{runs:[{text:'\ufffc',image:red},{text:'\ufffc',image:blue}]})]}}};
 const before=structuredClone(def);
 const {stories}=layout([paragraph('First'),paragraph('Second',{format:{pageBreakBefore:true}})],def);
 for(const page of [0,1]){
  const objects=stories.floatingObjects.filter(f=>f.page===page);
  expect(objects.map(f=>f.image.id)).toEqual(['blue','red']);
  expect(objects[0].x*.75).toBeCloseTo(215.95);expect(objects[1].x*.75).toBe(144);
 }
 expect(def).toEqual(before);
});
