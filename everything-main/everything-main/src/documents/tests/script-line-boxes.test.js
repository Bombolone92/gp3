import {it,expect} from 'vitest';
import {paragraph,TextDocument} from '../src/engine/model.js';
import {layoutDocument,caretRect,selectionRects,hitTest} from '../src/engine/layout.js';
import {fontMetrics} from '../src/engine/font-metrics.js';
import {prepareShapeAutofit} from '../src/engine/shape-autofit.js';
import {layoutShapeText} from '../src/engine/shape-text-layout.js';
const measure=(text,style)=>({...fontMetrics(style),width:text.length*style.fontSize*.6});
const run=(verticalAlign,baselineShift=0)=>({fontSize:20,verticalAlign,baselineShift});
function sample(verticalAlign,baselineShift=0){const p=paragraph('Test');Object.assign(p.runs[0],run(verticalAlign,baselineShift));return p;}
it('retains declared line metrics independently of script ink, shifts and caret geometry',()=>{
 for(const script of ['superscript','subscript'])for(const shift of [0,7,-7]){
  const base=layoutDocument([sample('baseline',shift)],measure),actual=layoutDocument([sample(script,shift)],measure);
  const a=actual.lines[0],b=base.lines[0],f=a.fragments[0];
  expect([a.y,a.height,a.baseline]).toEqual([b.y,b.height,b.baseline]);
  expect(f.ascent+f.descent).toBeCloseTo((fontMetrics(f).ascent+fontMetrics(f).descent)*.6);
  const c=caretRect(actual,2);expect(c.height).toBeLessThan(a.height);expect(hitTest(actual,c.page,c.x,c.y+c.height/2)).toBe(2);
  expect(selectionRects(actual,0,4)[0].height).toBe(a.height);
 }
});
it('uses declared script mark metrics for blank lines without enlarging the insertion caret',()=>{
 const p=paragraph('');p.markFormat=run('superscript');
 const actual=layoutDocument([p],measure),base=structuredClone(p);base.markFormat.verticalAlign='baseline';
 expect(actual.lines[0].height).toBe(layoutDocument([base],measure).lines[0].height);
 expect(caretRect(actual,0).height).toBeLessThan(actual.lines[0].height);
});
it('keeps whitespace from increasing mixed line height and restores line allocation on undo',()=>{
 const d=new TextDocument([paragraph('A B')]);d.select(1,2);d.setRunFormat({fontSize:80,verticalAlign:'superscript',baselineShift:7});
 const before=layoutDocument(d.paragraphs,measure),plain=layoutDocument([paragraph('A B')],measure);
 expect(before.lines[0].height).toBe(plain.lines[0].height);
 d.select(0,1);d.setRunFormat(run('subscript',-7));expect(layoutDocument(d.paragraphs,measure).lines[0].height).toBeGreaterThan(before.lines[0].height);
 d.undo();expect(layoutDocument(d.paragraphs,measure)).toEqual(before);
});
it('uses the same unscaled line allocation when fitting a retained text shape',()=>{
 const asset=verticalAlign=>({width:320,height:120,scene:{type:'shape',width:240*12700,height:90*12700,text:{autoFit:true,left:38100,right:38100,top:38100,bottom:38100,anchor:'t',paragraphs:[sample(verticalAlign)]}}});
 const source={base:asset('baseline'),script:asset('superscript')},before=JSON.stringify(source),f=prepareShapeAutofit(source,measure);
 expect(f.drawingLayouts.get('script').height).toBe(f.drawingLayouts.get('base').height);expect(JSON.stringify(source)).toBe(before);
});

it('suppresses explicit text-frame breaks alongside paragraphs with default formatting without mutation',()=>{
 const ps=[sample('baseline'),sample('superscript'),sample('baseline')];
 ps[1].format={pageBreakBefore:true};
 const node={width:240*12700,height:90*12700,text:{left:38100,right:38100,top:38100,bottom:38100,anchor:'t',paragraphs:ps}};
 const before=JSON.stringify(node),plain=structuredClone(node);plain.text.paragraphs[1].format.pageBreakBefore=false;
 const actual=layoutShapeText(node,measure),expected=layoutShapeText(plain,measure);
 expect(actual.layout.pages).toHaveLength(1);expect(actual.layout.lines).toEqual(expected.layout.lines);
 expect(JSON.stringify(node)).toBe(before);
});
