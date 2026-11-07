import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {autoColumnWidths,roundColumnWidths} from '../src/engine/tables.js';
it('binds selectively protected cells and unequal automatic content to native reference grids',()=>{
 const root='tests/fixtures/mixed-width-protection/',reference=JSON.parse(readFileSync(root+'reference.json'));
 for(const[name,hash]of Object.entries(reference.hashes))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex'),name).toBe(hash);
 const cases=JSON.parse(readFileSync(root+'cases.json'));expect(cases).toHaveLength(48);expect(reference.rows).toHaveLength(48);
 reference.rows.forEach(({widthTwips,...row},i)=>{expect(row).toEqual(cases[i]);expect(widthTwips).toHaveLength(row.columns);});
 expect(new Set(cases.map(c=>c.protection))).toEqual(new Set(['first','second','neither']));
 expect(new Set(cases.map(c=>c.automaticColumns))).toEqual(new Set([2,3,4]));expect(cases.some(c=>c.unequal)).toBe(true);
});
it.each([
 ['first',[2400,317,327,327],[3662,1340,499,499]],
 ['second',[317,1440,327,327],[2361,2503,568,568]],
 ['neither',[317,317,327,327],[2819,1823,679,679]],
])('allocates a growing merged minimum with %s absolute cell protected',(_,min,expected)=>{
 const table={grid:[3000,1800,600,600],width:{type:'dxa',value:6000},rows:[
  {cells:[{width:{type:'dxa',value:2400}},{width:{type:'dxa',value:1440}},{width:{type:'auto',value:0}},{width:{type:'auto',value:0}}]},
  {cells:[{span:4,width:{type:'dxa',value:6000},noWrap:true}]},
 ]};
 const intrinsic=min.map((m,i)=>({min:m,max:i<2?317:327,floor:216}));
 const spans=[{column:0,span:4,min:6000,max:807,floor:216}];const rounding={};
 const before=structuredClone({table,intrinsic,spans});const widths=autoColumnWidths(table,9360,intrinsic,9360,spans,rounding);
 expect(roundColumnWidths(widths,6000,min,spans,rounding)).toEqual(expected);
 expect({table,intrinsic,spans}).toEqual(before);
});

it('binds the partial merged-span controls to their independent reference capture',()=>{
 const root='tests/fixtures/mixed-pressure-partial/',reference=JSON.parse(readFileSync(root+'reference.json'));
 for(const[name,hash]of Object.entries(reference.hashes))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex'),name).toBe(hash);
 const cases=JSON.parse(readFileSync(root+'cases.json'));expect(cases).toHaveLength(12);expect(reference.rows).toHaveLength(12);
 reference.rows.forEach(({widthTwips,...row},i)=>{expect(row).toEqual(cases[i]);expect(widthTwips).toHaveLength(row.columns);expect(row.mergedColumns).toBe(row.columns-1);});
});
