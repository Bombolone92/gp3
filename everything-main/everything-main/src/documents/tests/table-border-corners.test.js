import { it, expect } from 'vitest';
import { layoutTableBorders } from '../src/engine/table-border-layout.js';
import { paintParagraphBorder } from '../src/engine/canvas-paragraph-borders.js';
import { joinTableBorderCorner } from '../src/engine/table-border-corners.js';
const border = (style='double', size=8) => ({style,size,color:'000000',space:0});
const cell = (borders, patch={}) => ({ id:'a',tableId:'t',page:0,x:10,y:20,width:100,height:40,borders, ...patch });
const all = edge => Object.fromEntries(['top','left','bottom','right'].map(s=>[s,edge]));
const painted = strokes => strokes.flatMap(stroke => {
 const boxes=[],ctx={save(){},restore(){},fillRect(...box){boxes.push(box);}};
 paintParagraphBorder(ctx,stroke); return boxes;
});

it('extends only the exposed outer bottom ink, retaining layout bounds and prepass geometry', () => {
 const cells=[cell({bottom:border('single',36)},{borderInsets:{top:0,bottom:3}})];
 const bottom=layoutTableBorders(cells).find(s=>s.side==='bottom');
 expect(bottom).toMatchObject({x:10,width:100,bandEnds:[[-1,100]]});
 expect(painted([bottom])[0]).toEqual([9,57,101,6]);
 expect(layoutTableBorders(cells,true).every(s=>!s.bandEnds)).toBe(true);
});

it('does not extend top edges or internal row edges as exposed bottom caps', () => {
 const top=layoutTableBorders([cell({top:border('single',36)},{borderInsets:{top:3,bottom:0}})]).find(s=>s.side==='top');
 expect(top.bandEnds).toBeUndefined();
 const cells=[cell({bottom:border('single',36)},{borderInsets:{top:0,bottom:3}}),cell({},{id:'b',y:60,borderInsets:{top:3,bottom:0}})];
 const internal=layoutTableBorders(cells).find(s=>!s.guide&&s.horizontal);
 expect(internal.bandEnds).toBeUndefined();expect(painted([internal])[0][0]).toBe(10);
});

it('does not add isolated caps at connected column segments or visible left corners', () => {
 const edge=border('single',36),base=cell({bottom:edge},{borderInsets:{top:0,bottom:3}});
 const bottoms=layoutTableBorders([base,{...base,id:'b',x:110}]).filter(s=>s.side==='bottom');
 expect(bottoms[0].bandEnds).toEqual([[-1,100]]);expect(bottoms[1].bandEnds).toBeUndefined();
 const joined=layoutTableBorders([{...base,borders:{bottom:edge,left:edge}}]).find(s=>s.side==='bottom');
 expect(joined.bandEnds[0][0]).toBe(-3);
});

it('joins outer and inner ink rings without crossings at all four double-border corners', () => {
 const strokes=layoutTableBorders([cell(all(border()))]);
 expect(strokes).toHaveLength(4); expect(strokes.every(s=>s.bandEnds?.length===2)).toBe(true);
 const top=strokes.find(s=>s.side==='top'), bottom=strokes.find(s=>s.side==='bottom');
 expect(top.bandEnds[0]).toEqual([-2,102]);expect(top.bandEnds[1][0]).toBeCloseTo(2/3);expect(top.bandEnds[1][1]).toBeCloseTo(100-2/3);
 expect(bottom.bandEnds[0][0]).toBeCloseTo(2/3); expect(bottom.bandEnds[1]).toEqual([-2,102]);
 const ink=painted(strokes);
 // The formerly crossing inner lines must leave all four corner gaps empty.
 for(const[x,y]of[[10,20],[110,20],[10,60],[110,60]]) expect(ink.some(([a,b,w,h])=>x>a&&x<a+w&&y>b&&y<b+h)).toBe(false);
});

it('uses distinct band widths for compound frames and clips extended vertical ink in its original coordinate system', () => {
 const edge={...border('thinThickLargeGap',24),frame:true}, strokes=layoutTableBorders([cell(all(edge),{borderInsets:{top:3.44,bottom:3.44},cellClip:{top:21,bottom:59}})]);
 expect(strokes.every(s=>s.bandEnds?.length===2)).toBe(true);
 for(const[x,y,w,h]of painted(strokes)) {expect(y).toBeGreaterThanOrEqual(21);expect(y+h).toBeLessThanOrEqual(59);expect(w).toBeGreaterThan(0);expect(h).toBeGreaterThan(0);}
});

it('keeps row-height prepasses and borderless guides unchanged', () => {
 const cells=[cell(all(border()))], pre=layoutTableBorders(cells,true);
 expect(pre.every(s=>!s.bandEnds)).toBe(true); expect(pre.map(s=>s.height)).toEqual([4,4]);
 expect(layoutTableBorders([cell({})]).every(s=>s.guide&&!s.bandEnds)).toBe(true);
});

it('reverses only the straight body of a framed left table edge, as in the isolated reference flag control', () => {
 const strokes=layoutTableBorders([cell(all({...border('thinThickLargeGap',48),frame:true}))]), left=strokes.find(s=>s.side==='left');
 const boxes=painted([left]), top=strokes.find(s=>s.side==='top'), bottom=strokes.find(s=>s.side==='bottom');
 expect(left.bandCaps.first.at).toBeCloseTo(top.y+top.height-left.y);expect(left.bandCaps.last.at).toBeCloseTo(bottom.y-left.y);
 const body=boxes.filter(b=>Math.abs(b[1]-(top.y+top.height))<1e-6);
 expect(body).toHaveLength(2);expect(body[0][2]).toBeCloseTo(.96);expect(body[1][2]).toBeCloseTo(1.92);
 expect(boxes[0][2]).toBeCloseTo(1.92);
});

it('does not invent a two-edge corner at a T-junction, across pages, or between different tables', () => {
 const edges=all(border()), left=cell(edges), right=cell(edges,{id:'b',x:110});
 const strokes=layoutTableBorders([left,right]);
 const shared=strokes.find(s=>!s.horizontal&&s.cellIds.length===2);
 expect(shared.bandEnds).toBeUndefined();
 const isolated=layoutTableBorders([cell({top:border()},{tableId:'a'}),cell({left:border()},{tableId:'b'}),cell({left:border()},{page:1})]);
 expect(isolated.every(s=>!s.bandEnds)).toBe(true);
});

it('butts unlike patterns at the inside horizontal edge and leaves dashed junction patterns alone', () => {
 const h={horizontal:true,side:'top',x:10,y:20,width:100,height:6.88,border:border('thinThickLargeGap',24)},v={horizontal:false,side:'left',x:8,y:20,width:4,height:50,border:border()};
 joinTableBorderCorner([{stroke:h,first:true},{stroke:v,first:true}]);
 expect(h.bandEnds[0][0]).toBe(-2);expect(h.bandEnds[1][0]).toBe(-2);
 expect(v.bandEnds[0][0]).toBeCloseTo(6.88);expect(v.bandEnds[1][0]).toBeCloseTo(6.88);
 const unsupported={...v,border:border('dashed'),bandEnds:undefined};
 joinTableBorderCorner([{stroke:{...h,bandEnds:undefined},first:true},{stroke:unsupported,first:true}]);
 expect(unsupported.bandEnds).toBeUndefined();
});
