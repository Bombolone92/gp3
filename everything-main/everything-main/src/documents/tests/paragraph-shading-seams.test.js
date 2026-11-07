import { it, expect } from 'vitest';
import { paintParagraphBackgrounds } from '../src/engine/canvas-paragraph-backgrounds.js';
const color='#224466';
const rect=(y,height=10,x=0,width=20,fill=color)=>({x,y,width,height,color:fill});
const stroke=(y,height=.5,extra={})=>({x:0,y,width:20,height,horizontal:true,background:'#FFFFFF',border:{style:'single',color:'224466'},...extra});
function paint(rects,borders=[]) {
  const fills=[];let path=[];
  const ctx={beginPath(){path=[];},rect(...args){path.push(args);},fill(){fills.push({color:this.fillStyle,path:[...path]});}};
  paintParagraphBackgrounds(ctx,rects,borders);return fills;
}
it('unites fractional adjacent shading in one path, including different widths',()=>{
  expect(paint([rect(.25),rect(10.25,10,5,15)])).toEqual([{color,path:[[0,.25,20,10],[5,10.25,15,10]]}]);
});
it('bridges only ink fully covered by matching opaque single borders',()=>{
  const rects=[rect(.25),rect(11.25)],borders=[stroke(10.25),stroke(10.75)];
  expect(paint(rects,borders)[0].path).toContainEqual([0,10.25,20,1]);
  for(const modified of [[],[stroke(10.25)],[stroke(10.25,1,{border:{style:'dashed',color:'224466'}})],[stroke(10.25,1,{border:{style:'single',color:'CC3300'}})],[stroke(10.25,1,{cellClip:{left:1,right:20,top:0,bottom:30}})],[stroke(10.25,1,{clip:[[0,10.25],[20,10.25],[19,11.25],[1,11.25]]})]]) {
    expect(paint(rects,modified)[0].path).toHaveLength(2);
  }
});
it('preserves color order and gaps between nonmatching or uncovered regions',()=>{
  expect(paint([rect(.25),rect(10.25,10,0,20,'#CC3300'),rect(20.25)])).toHaveLength(3);
  expect(paint([rect(.25),rect(12.25)],[stroke(10.25,1)])[0].path).toHaveLength(2);
  expect(paint([rect(.25),rect(10.75)],[stroke(10.25,1,{cellClip:{left:0,right:20,top:0,bottom:10.5}})])[0].path).toHaveLength(2);
});
it('absorbs only adjacent matching solid vertical ink and retains clipped corners',()=>{
 const rects=[rect(0,20,0,20.4)],base={x:20.4,y:0,width:2,height:20,horizontal:false,background:'#FFFFFF',border:{style:'single',color:'224466'}};
 const polygons=[];let points=[];
 const ctx={beginPath(){},rect(){},fill(){},moveTo(...p){points=[p];},lineTo(...p){points.push(p);},closePath(){polygons.push(points);}};
 const edge={...base,clip:[[20.4,2],[22.4,0],[22.4,20],[20.4,18]],cellClip:{left:0,right:21.4,top:1,bottom:19}};
 const ink=paintParagraphBackgrounds(ctx,rects,[edge]);
 expect(ink.get(edge)).toEqual([{x:20.4,y:1,width:1,height:18}]);
 expect(polygons[0]).toEqual([[20.4,2],[21.4,1],[21.4,19],[20.4,18]]);
 for(const b of [{...base,x:21}, {...base,border:{style:'dashed',color:'224466'}}, {...base,border:{style:'single',color:'CC3300'}}, {...base,cellClip:{left:0,right:80,top:21,bottom:30}}]){
  expect(paintParagraphBackgrounds(ctx,rects,[b]).size).toBe(0);
 }
 expect(paintParagraphBackgrounds(ctx,[...rects,rect(1,5,21,5,'#CC3300')],[base]).size).toBe(0);
});
