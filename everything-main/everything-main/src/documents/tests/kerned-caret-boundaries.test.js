import {it,expect} from 'vitest';
import {paragraph} from '../src/engine/model.js';
import {RUN_FORMAT} from '../src/engine/formatting.js';
import {layoutDocument,caretRect,hitTest,selectionRects} from '../src/engine/layout.js';

const measure=(text,style)=>({width:text.length*10-(style.kerning?([...text.matchAll(/AV|VA/g)].length*2):0),ascent:12,descent:3});
const document=kerning=>{const p=paragraph('');p.runs=[{...RUN_FORMAT,text:'AVAVA',kerning,ligatures:'none'}];return p;};

it('uses the following pair adjustment for carets, pointer targets and selection edges',()=>{
  const p=document(1);
  // Overlapping pairs must each contribute their adjustment.
  const shaped=(text,style)=>({width:text.length*10-(style.kerning?[...text].slice(1).reduce((n,c,i)=>n+(/AV|VA/.test(text[i]+c)?2:0),0):0),ascent:12,descent:3});
  const corrected=layoutDocument([p],shaped),row=corrected.lines[0],left=row.stops[0].x;
  expect(row.stops.map(s=>s.x-left)).toEqual([0,8,16,24,32,42]);
  for(const stop of row.stops){
    expect(caretRect(corrected,stop.offset).x).toBe(stop.x);
    expect(hitTest(corrected,0,stop.x,row.y+1)).toBe(stop.offset);
  }
  expect(selectionRects(corrected,1,3)[0]).toMatchObject({x:left+8,width:16});
  expect(p.runs[0].text).toBe('AVAVA');
});

it('retains disabled kerning geometry and caches repeated isolated glyph requests',()=>{
  const disabled=layoutDocument([document(0)],measure).lines[0];
  expect(disabled.stops.map(s=>s.x-disabled.stops[0].x)).toEqual([0,10,20,30,40,50]);
  const p=document(1);p.runs[0].text='AV'.repeat(20);
  const single=[];
  layoutDocument([p],(text,style)=>{if(text.length===1)single.push(text);return measure(text,style);});
  // The fitting probe and final shaping share one measurer. Only a new
  // isolated V is needed; initial A prefixes already provide its advance.
  expect(single.filter(c=>c==='V')).toHaveLength(1);
  expect(single.filter(c=>c==='A').length).toBeLessThanOrEqual(2);
});

it('gives all-caps source text the same kerned boundaries as stored uppercase',()=>{
  const shaped=(text,style)=>({width:text.length*10-(style.kerning?[...text].slice(1).reduce((n,c,i)=>n+(/AV|VA/.test(text[i]+c)?2:0),0):0),ascent:12,descent:3});
  const geometry=(text,capitalization,kerning=1)=>{
    const p=document(kerning);Object.assign(p.runs[0],{text,capitalization});
    const layout=layoutDocument([p],shaped),row=layout.lines[0],left=row.stops[0].x;
    for(const stop of row.stops)expect(hitTest(layout,0,stop.x,row.y+1)).toBe(stop.offset);
    expect(p.runs[0].text).toBe(text);
    return {carets:row.stops.map(s=>s.x-left),width:row.fragments[0].width};
  };
  expect(geometry('avava','caps')).toEqual(geometry('AVAVA','normal'));
  expect(geometry('aVaVa','caps')).toEqual(geometry('AVAVA','normal'));
  expect(geometry('avava','caps',0).carets).toEqual([0,10,20,30,40,50]);
  const p=document(1);Object.assign(p.runs[0],{text:'av'.repeat(20),capitalization:'caps'});
  const isolated=[];
  layoutDocument([p],(text,style)=>{if(text.length===1)isolated.push(text);return shaped(text,style);});
  expect(isolated.filter(c=>c==='V')).toHaveLength(1);
});
