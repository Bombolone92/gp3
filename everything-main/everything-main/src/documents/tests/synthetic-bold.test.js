import { it, expect, vi } from 'vitest';
import { isSynthesizedInk, permitsSyntheticStroke, probeSyntheticBold, usesSyntheticBold, usesSyntheticAdvance } from '../src/engine/synthetic-bold.js';

it('requires both the regular face and the forced synthetic ink to match', () => {
  const regular = new Uint8Array([0, 80, 255, 0]), bold = new Uint8Array([20, 160, 255, 50]);
  expect(isSynthesizedInk(regular, bold, regular.slice(), bold.slice())).toBe(true);
  expect(isSynthesizedInk(regular, new Uint8Array([30, 150, 255, 90]), regular, bold)).toBe(false);
  expect(isSynthesizedInk(regular, bold, new Uint8Array([0, 90, 255, 0]), bold)).toBe(false);
});
it('separates native outline simulation from nonstandard face weights',()=>{
 for(const weight of [300,400])expect(permitsSyntheticStroke({weight,bold:false,variable:false})).toBe(true);
 for(const weight of [100,200,250,299,301,349,350,351,399,401,499,500,501,550,600,650,700,800,900])expect(permitsSyntheticStroke({weight,bold:false,variable:false}),String(weight)).toBe(false);
 expect(permitsSyntheticStroke({weight:400,bold:true,variable:false})).toBe(false);
 expect(permitsSyntheticStroke(null)).toBe(true);
 expect(permitsSyntheticStroke({weight:500,variable:true})).toBe(true);
});
it('does not embolden an already-bold face or empty/unsupported samples', () => {
  const bold = new Uint8Array([10, 160, 255, 70]);
  expect(isSynthesizedInk(bold, bold, bold, bold)).toBe(false);
  expect(isSynthesizedInk([], [], [], [])).toBe(false);
  expect(isSynthesizedInk([1], [2], [1, 0], [2])).toBe(false);
});
it('synthesizes unchanged ink only for an explicitly registered normal-only family',()=>{
 const regular=[0,80,255,0];
 expect(isSynthesizedInk(regular,regular,regular,regular,true,true)).toBe(true);
 expect(isSynthesizedInk(regular,regular,regular,regular,true,false)).toBe(false);
 expect(isSynthesizedInk(regular,regular,[0,90,255,0],regular,false,true)).toBe(false);
 expect(isSynthesizedInk([],[],[],[],true,true)).toBe(false);
});

it('clears prior synthesis decisions without sampling bold when regular faces differ',async()=>{
 let mismatch=false,draws=0;
 const context={font:'',clearRect(){},fillText(){draws++;},getImageData(){
  const data=new Uint8ClampedArray(800*96*4),absent=this.font.includes(' absent'),native=this.font.includes('"Fixture"');
  data[3]=absent?0:mismatch&&native?3:this.font.includes(' 700 ')?2:1;return {data};
 }};
 const fonts=new Set();
 vi.stubGlobal('window',{});vi.stubGlobal('document',{fonts,createElement:()=>({getContext:()=>context})});
 vi.stubGlobal('FontFace',class{async load(){return this;}});
 try{
  await probeSyntheticBold('Fixture','local("Fixture")');
  for(const italic of [false,true]){
   expect(usesSyntheticBold({bold:true,italic},'Fixture')).toBe(true);
   expect(usesSyntheticAdvance({bold:true,italic},'Fixture')).toBe(true);
  }
  mismatch=true;draws=0;
  expect(await probeSyntheticBold('Fixture','local("Fixture")')).toBe(true);
  expect(draws).toBe(6);
  for(const italic of [false,true]){
   expect(usesSyntheticBold({bold:true,italic},'Fixture')).toBe(false);
   expect(usesSyntheticAdvance({bold:true,italic},'Fixture')).toBe(false);
  }
  expect(fonts.size).toBe(0);
 }finally{vi.unstubAllGlobals();}
});
