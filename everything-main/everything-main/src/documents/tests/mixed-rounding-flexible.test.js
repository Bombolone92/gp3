import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {roundColumnWidths,autoColumnWidths} from '../src/engine/tables.js';
it('binds flexible-column counts and unequal content to native reference grids',()=>{
 const root='tests/fixtures/mixed-rounding-flexible/',r=JSON.parse(readFileSync(root+'reference.json'));
 for(const[name,hash]of Object.entries(r.hashes))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex'),name).toBe(hash);
 const cases=JSON.parse(readFileSync(root+'cases.json'));expect(r.rows).toHaveLength(16);
 r.rows.forEach(({widthTwips,...c},i)=>{expect(c).toEqual(cases[i]);expect(widthTwips).toHaveLength(c.columns);expect(widthTwips.every(Number.isInteger)).toBe(true);});
 expect(new Set(cases.map(c=>c.automaticColumns))).toEqual(new Set([2,3,4]));expect(cases.some(c=>c.unequal)).toBe(true);
});
it('keeps protected allocations and transfers rounding through automatic columns',()=>{
 const widths=[3204.272363150868,1922.5634178905211,436.5821094793055,436.5821094793055],minimums=[2400,1440,327,327],rounding={flexible:[false,false,true,true]};
 const before=structuredClone({widths,minimums,rounding});
 expect(roundColumnWidths(widths,6000,minimums,[],rounding)).toEqual([3205,1923,436,436]);
 expect(roundColumnWidths(widths,6000,minimums,[{column:0,span:4,min:6000}],rounding)).toEqual([3204,1923,437,437]);
 expect({widths,minimums,rounding}).toEqual(before);
 // Ordinary/fixed rounding keeps its existing total and allocation.
 expect(roundColumnWidths(widths,6000,minimums)).toEqual([3203,1923,437,437]);
});

it('retains ordinary grid rounding when an automatic cell spans unresolved columns',()=>{
 const fixed=value=>({width:{type:'dxa',value},noWrap:true});
 const automatic=span=>({span,width:{type:'auto',value:0},noWrap:true});
 const table={grid:[3000,1800,600,600],width:{type:'dxa',value:6000},rows:[
  {cells:[fixed(2400),fixed(1440),automatic(1),automatic(1)]},
  {cells:[{span:4,width:{type:'dxa',value:6000}}]},
 ]};
 const intrinsic=[{min:2400,max:317,floor:216},{min:1440,max:317,floor:216},{min:327,max:327,floor:226},{min:327,max:327,floor:226}];
 const rounding={};autoColumnWidths(table,9360,intrinsic,9360,[],rounding);
 expect(rounding.flexible).toEqual([false,false,true,true]);
 table.rows[0].cells.splice(2,2,automatic(2));
 const widths=autoColumnWidths(table,9360,intrinsic,9360,[],rounding);
 expect(rounding.flexible).toBeUndefined();
 expect(roundColumnWidths(widths,6000,[],[],rounding)).toEqual(roundColumnWidths(widths,6000));
});
