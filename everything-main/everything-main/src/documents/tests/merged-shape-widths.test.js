import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {autoColumnWidths} from '../src/engine/tables.js';
const folder='tests/fixtures/merged-shape-widths/';
it('binds the independent controls to their native reference',()=>{
 const ref=JSON.parse(readFileSync(folder+'merged-shape-width-reference.json'));
 expect(ref.pages).toHaveLength(6);
 for(const [name,hash] of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(folder+name)).digest('hex')).toBe(hash);
});
it.each([1070,1430])('keeps a feasible merged minimum separate from individual column minima (%i twips)',minimum=>{
 const cell=(value,span=1)=>({span,width:{type:'dxa',value}});
 const table={layout:'autofit',grid:[900,3000,900],width:{type:'dxa',value:4800},rows:[{cells:[cell(4800,3)]},{cells:[cell(3900,2),cell(900)]},{cells:[cell(900),cell(3900,2)]}]};
 const intrinsic=[minimum,0,minimum].map(min=>({min,max:min,floor:min,paddingFloor:0,contentMin:min}));
 const baseline=structuredClone({table,intrinsic});
 const spans=[{column:0,span:3,min:4200,max:4200,floor:240,paddingFloor:230,contentMin:4200}];
 const expected=[minimum,4800-2*minimum,minimum];
 expect(autoColumnWidths(table,9360,intrinsic,9360,spans)).toEqual(expected);
 expect({table,intrinsic}).toEqual(baseline);
 expect(autoColumnWidths({...table,rows:[...table.rows].reverse()},9360,intrinsic,9360,spans)).toEqual(expected);
});
