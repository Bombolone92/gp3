import { it, expect } from 'vitest';
import { geometryGuides } from '../src/engine/geometry-guides.js';

it.each([
  ['*/ 7 2 3', 14 / 3], ['+- 6 3 1', 8], ['+/ 6 3 2', 4.5],
  ['?: 0 3 7', 7], ['?: 1 3 7', 3], ['abs -6', 6],
  ['at2 -1 1', 8100000], ['at2 -1 -1', -8100000],
  ['cat2 100 3 4', 60], ['cos 100 3600000', 50], ['max 2 7', 7],
  ['min 2 7', 2], ['mod 2 3 6', 7], ['pin 2 9 7', 7],
  ['pin 2 0 7', 2], ['sat2 100 3 4', 80], ['sin 100 1800000', 50],
  ['sqrt 49', 7], ['tan 50 2700000', 50], ['val -65', -65],
])('evaluates %s', (formula, expected) => {
  expect(geometryGuides(200, 100, [], [{ name: 'result', formula }])('result')).toBeCloseTo(expected, 7);
});

it('resolves adjustments, ordered guides and shape-space built-ins', () => {
  const get = geometryGuides(200, 100, [{ name: 'adj', formula: 'val 25' }],
    [{ name: 'inset', formula: '*/ w adj 100' }, { name: 'edge', formula: '+- r 0 inset' }]);
  expect(get('edge')).toBe(150); expect(get('vc')).toBe(50);
  expect(get('ssd4')).toBe(25); expect(get('wd2')).toBe(100); expect(get('3cd4')).toBe(16200000);
  expect(get(' -12 ')).toBe(-12);
});

it.each(['*/ 1 2 0', 'sqrt -1', 'val 9007199254740992', 'val missing', '*/ 1 2', 'abs 1 2', 'pow 2 3', 'constructor 0'])('rejects invalid formula %s', formula => {
  expect(() => geometryGuides(200, 100, [], [{ name: 'g', formula }])).toThrow(/Invalid drawing geometry/);
});
it('rejects forward references', () => {
  expect(() => geometryGuides(200, 100, [], [{name:'first',formula:'val second'}, {name:'second',formula:'val 1'}])).toThrow(/forward/);
});

it('evaluates a long ordered dependency chain across adjustment and guide lists', () => {
  const chain=Array.from({length:32768},(_,i)=>({name:`g${i}`,formula:i?`+- g${i-1} 1 0`:'val 1'}));
  const get=geometryGuides(200,100,chain.slice(0,16384),chain.slice(16384));
  expect(get('g0')).toBe(1);expect(get('g16383')).toBe(16384);expect(get('g32767')).toBe(32768);
});
it.each([
 ['forward reference',{name:'end',formula:'val later'},/forward/],
 ['nonfinite result',{name:'end',formula:'*/ g10000 1 0'},/nonfinite/],
])('still rejects a late %s after a large valid guide list',(_label,last,error)=>{
 const guides=Array.from({length:12000},(_,i)=>({name:`g${i}`,formula:`val ${i}`}));
 expect(()=>geometryGuides(200,100,[],[...guides,last])).toThrow(error);
});

it('rebinds repeated declarations without recalculating earlier dependents', () => {
 const get=geometryGuides(200,100,[{name:'g',formula:'val 25'},{name:'g',formula:'val 30'}],
  [{name:'saved',formula:'val g'},{name:'g',formula:'val 75'},{name:'self',formula:'+- self 40 0'},
   {name:'g',formula:'+- g 20 0'},{name:'w',formula:'val 90'}]);
 expect(get('saved')).toBe(30);expect(get('g')).toBe(20);expect(get('self')).toBe(40);expect(get('w')).toBe(90);
});
it('rebinds late declarations in a large guide list',()=>{
 const guides=Array.from({length:12000},(_,i)=>({name:`g${i}`,formula:`val ${i}`}));
 expect(geometryGuides(200,100,[],[...guides,{name:'g10000',formula:'val 1'}])('g10000')).toBe(1);
});
it('keeps unresolved built-in self-reference guarded',()=>{
 expect(()=>geometryGuides(200,100,[],[{name:'w',formula:'*/ w 1 2'}])).toThrow(/self-referential built-in/);
});
