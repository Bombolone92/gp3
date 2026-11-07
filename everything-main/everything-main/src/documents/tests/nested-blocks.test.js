import {it,expect} from 'vitest';
import {documentBlocks} from '../src/engine/tables.js';
const p=(id,text,cellId)=>({id,runs:[{text}],...(cellId?{cellId}:{})});
const table=(id,cells,parentCellId)=>({id,grid:cells[0].map(()=>1440),rows:cells.map((ids,i)=>({id:`${id}-r${i}`,cells:ids.map(id=>({id}))})),...(parentCellId?{parentCellId}:{})});
it('keeps nested table hierarchy and a single global source-offset order',()=>{
  const outer=table('outer',[['left','right'],['lower-left','lower-right']]);
  const inner=table('inner',[['a','b'],['c','d']],'left');
  const paragraphs=[p('p0','Title'),p('p1','Before','left'),p('p2','A','a'),p('p3','B','b'),p('p4','C','c'),p('p5','D','d'),p('p6','After','left'),p('p7','Side','right'),p('p8','Lower left','lower-left'),p('p9','Lower right','lower-right'),p('p10','End')];
  const blocks=documentBlocks(paragraphs,[inner,outer]);
  expect(blocks.map(b=>b.type)).toEqual(['paragraph','table','paragraph']);
  const left=blocks[1].rows[0].cells[0].content;
  expect(left.map(b=>b.paragraph?.id||b.table.id)).toEqual(['p1','inner','p6']);
  expect(left[1].rows[1].cells[1].content[0]).toEqual({paragraph:paragraphs[5],index:5,offset:19});
  expect(blocks[2].offset).toBe(paragraphs.slice(0,-1).reduce((n,p)=>n+p.runs[0].text.length+1,0));
});
it('allows a nested table as the first content in a cell and multiple nesting levels',()=>{
  const outer=table('outer',[['outer-cell']]), middle=table('middle',[['middle-cell']],'outer-cell'),inner=table('inner',[['inner-cell']],'middle-cell');
  const blocks=documentBlocks([p('a','Inner','inner-cell'),p('b','Middle tail','middle-cell'),p('c','Outer tail','outer-cell')],[outer,middle,inner]);
  expect(blocks[0].rows[0].cells[0].content[0].rows[0].cells[0].content[0].table.id).toBe('inner');
});
it('retains the existing flat cell block shape',()=>{
  const paragraphs=[p('a','A','cell')],t=table('table',[['cell']]);
  expect(documentBlocks(paragraphs,[t])[0].rows[0].cells[0].content).toEqual([{paragraph:paragraphs[0],index:0,offset:0}]);
});
it('rejects missing, cyclic and discontiguous ownership',()=>{
  expect(()=>documentBlocks([p('a','A','cell')],[table('t',[['cell']],'missing')])).toThrow(/missing parent/);
  expect(()=>documentBlocks([p('a','A','cell')],[table('t',[['cell']],'cell')])).toThrow(/cycle/);
  expect(()=>documentBlocks([p('a','A','cell'),p('b','Outside'),p('c','Again','cell')],[table('t',[['cell']])])).toThrow(/contiguous/);
});
