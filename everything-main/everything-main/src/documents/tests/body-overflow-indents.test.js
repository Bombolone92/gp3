import {it,expect} from 'vitest';
import {paragraph} from '../src/engine/model.js';
import {layoutDocument,caretRect,selectionRects,hitTest,verticalLine} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const measure=text=>({width:text.length*8,ascent:12,descent:4});
it.each([-5000,15000])('clips interaction for a wholly off-paper paragraph at indent %s',indentLeft=>{
 const p=[paragraph('Before'),paragraph('Hidden',{format:{indentLeft,indentRight:-16000}}),paragraph('After')];
 const l=layoutDocument(p,measure,pageGeometry()),hidden=l.lines.find(x=>x.paragraphId===p[1].id),before=l.lines[0],after=l.lines.at(-1);
 expect(hidden).toBeTruthy();expect(hidden.stops[0].x<0 || hidden.stops[0].x>816).toBe(true);
 expect(caretRect(l,hidden.start).x).toBe(indentLeft<0?0:815);
 expect(selectionRects(l,hidden.start,hidden.end)).toEqual([]);
 const hit=hitTest(l,0,indentLeft<0?0:815,hidden.y+hidden.height/2);
 expect(hit<hidden.start || hit>hidden.end).toBe(true);
 expect(verticalLine(l,before,1,100)).toBe(after);
 expect(verticalLine(l,after,-1,100)).toBe(before);
});
it('clips partial selections on both edges while preserving off-page source stops',()=>{
 const p=paragraph('abcdefghij '.repeat(30),{format:{indentLeft:-2520,indentRight:-7200}});
 const l=layoutDocument([p],measure,pageGeometry());
 expect(l.lines[0].stops[0].x).toBeLessThan(0);expect(l.lines[0].stops.at(-1).x).toBeGreaterThan(816);
 const rects=selectionRects(l,0,l.lines.at(-1).end);
 expect(rects[0]).toMatchObject({x:0,width:816});
 for(const r of rects){expect(r.x).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(816);}
});
