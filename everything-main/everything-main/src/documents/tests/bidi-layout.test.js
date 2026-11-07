import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {bidiCharacters,bidiLineCharacters,bidiVisualOrder,bidiMirroredCharacter,bidiPaintText} from '../src/engine/bidi-text.js';
import {paragraph} from '../src/engine/model.js';
import {RUN_FORMAT} from '../src/engine/formatting.js';
import {layoutDocument,caretRect,hitTest,selectionRects} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';

const chars = runs => {
  const result=[];let offset=0;
  for(const run of runs) {
    for(const s of new Intl.Segmenter().segment(run.text)) result.push({text:s.segment,start:offset+s.index,end:offset+s.index+s.segment.length,style:{...RUN_FORMAT,...run}});
    offset+=run.text.length;
  }
  return result;
};
const visual = values => bidiVisualOrder(values,c=>c.style.bidiLevel).map(c=>c.style.bidiLevel%2 ? [...c.text].map(bidiMirroredCharacter).join('') : c.text).join('');
const normalize = text => text.replace(/[\[\]()]/g,'').replace(/\s+/g,' ').trim();
const cases=JSON.parse(readFileSync('tests/fixtures/rtl-runs/cases.json','utf8'));
const reference=JSON.parse(readFileSync('tests/fixtures/rtl-runs/reference.json','utf8'));

it('binds the independent native RTL order reference to its source and PDF',()=>{
  for(const [file,key] of [['control.docx','sourceSha256'],['native.pdf','pdfSha256'],['cases.json','casesSha256']]) expect(createHash('sha256').update(readFileSync('tests/fixtures/rtl-runs/'+file)).digest('hex')).toBe(reference[key]);
});
it.each(cases)('matches native word/number order for case $index ($mode)',c=>{
  const glyphs=reference.pages[c.page],ys=[...new Set(glyphs.map(g=>g.y.toFixed(2)))].map(Number).sort((a,b)=>a-b);
  const y=ys[(c.index%7)*2+1],native=glyphs.filter(g=>Math.abs(g.y-y)<.02).sort((a,b)=>a.x-b.x).map(g=>g.text).join('');
  const source=chars([{text:'Left [ '},{text:c.text,rtl:c.mode!=='ltr'},{text:' ] Right'}]);
  const snapshot=structuredClone(source),resolved=bidiLineCharacters(bidiCharacters(source));
  // The reference PDF's ToUnicode map sends some mirrored brackets to the same character.
  // Native words/numbers remain an independent order oracle; mirror behavior
  // is separately asserted below rather than inferred from that lossy mapping.
  expect(normalize(visual(resolved))).toBe(normalize(native));
  expect(source).toEqual(snapshot);
  expect(resolved.map(c=>[c.start,c.end,c.text])).toEqual(source.map(c=>[c.start,c.end,c.text]));
});
it('mirrors brackets, keeps graphemes intact, and classifies supplementary RTL code points',()=>{
  expect(visual(bidiCharacters(chars([{text:'(אבג)',rtl:true}])))).toBe('(גבא)');
  const source=chars([{text:'א\u05b0ב',rtl:true}]);
  expect(visual(bidiCharacters(source))).toBe('בא\u05b0');
  const supplementary=chars([{text:'\u{1e900}\u{1e901}',rtl:true}]);
  const resolved=bidiCharacters(supplementary);
  expect(resolved.map(c=>[c.start,c.end])).toEqual([[0,2],[2,4]]);
  expect(visual(resolved)).toBe('\u{1e901}\u{1e900}');
});
it('resets line and tab whitespace without treating NBSP or directional marks as whitespace',()=>{
  const source=bidiCharacters(chars([{text:'אב  \tגד \u00a0\u200f',rtl:true}]));
  const snapshot=structuredClone(source);
  const first=bidiLineCharacters(source.slice(0,4));expect(first.slice(-2).map(c=>c.style.bidiLevel)).toEqual([0,0]);
  const all=bidiLineCharacters(source);expect(all[4].style.bidiLevel).toBe(0);
  expect(all.at(-1).style.bidiLevel%2).toBe(1);expect(all.at(-2).style.bidiLevel%2).toBe(1);
  expect(source).toEqual(snapshot);
  // The paragraph resolver already resets whitespace preceding a tab. A
  // soft line break has no separator and must be reset by the line adapter.
  const soft=bidiCharacters(chars([{text:'אב  גד'}]));
  expect(soft[2].style.bidiLevel%2).toBe(1);
  const explicit=bidiCharacters(chars([{text:'אב  גד',rtl:true}]));
  expect(bidiLineCharacters(explicit.slice(0,4))[2].style.bidiLevel).toBe(1);
  expect(bidiLineCharacters(soft.slice(0,4))[2].style.bidiLevel).toBe(0);
  expect(soft[2].style.bidiLevel%2).toBe(1);
});
it('retains native shaping text inside the resolved direction override',()=>{
  expect(bidiPaintText('مرحبا',{bidiDirection:'rtl'})).toBe('\u202eمرحبا\u202c');
  expect(bidiPaintText('A\u202eB\u202c',{bidiDirection:'ltr'})).toBe('\u202dAB\u202c');
  expect(bidiPaintText('ABC',{})).toBe('ABC');
});
it('moves colors, backgrounds and logical carets with the visual Hebrew glyphs',()=>{
  const p=paragraph('');const base={...RUN_FORMAT,rtl:true,fontSize:10,fontSizeCs:10};
  p.runs=[{...base,text:'א',color:'ff0000',highlight:'yellow'},{...base,text:'ב',color:'0000ff'}];
  const before=structuredClone(p),layout=layoutDocument([p],(t)=>({width:[...t].length*10,ascent:12,descent:3}),pageGeometry());
  const line=layout.lines[0],f=line.fragments[0];
  expect(f.colors.map(c=>[c.value,c.x,c.width])).toEqual([['0000ff',0,10],['ff0000',10,10]]);
  expect(line.backgrounds[0]).toMatchObject({x:f.x+10,width:10});
  expect(caretRect(layout,0).x).toBe(f.x+20);expect(caretRect(layout,2,'backward').x).toBe(f.x);
  expect(hitTest(layout,0,f.x+1,line.y+line.height/2)).toBe(2);
  expect(selectionRects(layout,0,1)[0]).toMatchObject({x:f.x+10,width:10});
  expect(p).toEqual(before);
});
