import { expect, it, vi } from 'vitest';
import { mergeBorderSegments } from '../src/core/merge-borders.js';

const merge = { r1: 3, c1: 5, r2: 5, c2: 7 };
const side = (key, color = '#123456', bs = 'thin') => ({ [key]: true, [`${key}Border`]: { bc: color, bs } });
const collect = (styleAt, rows = [3,4,5], cols = [5,6,7]) => mergeBorderSegments(merge, rows, cols,
  r => [20,30,50][r-3], c => [40,100,60][c-5], styleAt);

it('keeps anchor formatting on its actual perimeter and suppresses internal edges', () => {
  const parts = collect((r,c) => r===3 && c===5 ? { bt:true,bb:true,bl:true,br:true,bs:'medium' } : null);
  expect(parts).toEqual([
    {side:'bt',start:0,end:.2,width:'2px',style:'solid',color:null},
    {side:'bl',start:0,end:.2,width:'2px',style:'solid',color:null},
  ]);
});

it('retains gaps, independent side styles, and unequal physical line sizes', () => {
  const parts = collect((r,c) => ({ ...(r===5 && c!==6 ? side('bb', c===5?'red':'blue',c===5?'thin':'double') : {}),
    ...(c===7 && r===4 ? side('br','green','dashed') : {}) }));
  expect(parts).toEqual([
    {side:'bb',start:0,end:.2,width:'1px',style:'solid',color:'red'},
    {side:'bb',start:.7,end:1,width:'3px',style:'double',color:'blue'},
    {side:'br',start:.2,end:.5,width:'1px',style:'dashed',color:'green'},
  ]);
});

it('coalesces adjoining equal rules without bridging absent edges', () => {
  expect(collect((r,c)=>r===3?side('bt'):null).filter(e=>e.side==='bt'))
    .toEqual([{side:'bt',start:0,end:1,width:'1px',style:'solid',color:'#123456'}]);
  expect(collect((r,c)=>r===3&&c!==6?side('bt'):null)).toHaveLength(2);
});

it.each([[4,5],[3,5],[3,4]])('omits hidden/clipped lines and only draws reached boundary rows %j', (...rows) => {
  const parts = collect(() => ({bt:true,bb:true,bl:true,br:true}), rows);
  expect(parts.some(p=>p.side==='bt')).toBe(rows.includes(3));
  expect(parts.some(p=>p.side==='bb')).toBe(rows.includes(5));
  expect(parts.find(p=>p.side==='bl')).toMatchObject({start:0,end:1});
});

it('omits hidden/clipped boundary columns and ignores zero-length segments', () => {
  expect(collect(() => ({bt:true,bb:true,bl:true,br:true}), [3,4,5], [6])).toEqual([
    {side:'bt',start:0,end:1,width:'1px',style:'solid',color:null},
    {side:'bb',start:0,end:1,width:'1px',style:'solid',color:null},
  ]);
  expect(mergeBorderSegments(merge,[3],[5],()=>0,()=>0,()=>({bt:true,bl:true}))).toEqual([]);
});

it('reads only perimeter cells, keeping large merged areas linear in side length', () => {
  const read = vi.fn(()=>null), lines=Array.from({length:600},(_,i)=>i);
  mergeBorderSegments({r1:0,c1:0,r2:599,c2:599},lines,lines,()=>20,()=>80,read);
  expect(read).toHaveBeenCalledTimes(2400);
});

it('keeps sparse viewport segments at their full-box positions without bridging omitted lines', () => {
  const parts=mergeBorderSegments({r1:0,c1:0,r2:99,c2:2},[0,50,51],[0],()=>20,()=>80,()=>({bl:true}),
    {width:240,height:2000,rowPosition:r=>r*20,colPosition:c=>c*80});
  expect(parts.map(p=>[p.start,p.end])).toEqual([[0,.01],[.5,.52]]);
});
