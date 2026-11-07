import {it,expect} from 'vitest';
import {rectanglePathBounds,supportsSolidRectangleDisplay,solidRectangleDeviceFrame} from '../src/engine/solid-rectangle-display.js';
const path={width:1,height:1,fill:true,points:[['M',0,0],['L',1,0],['L',1,1],['L',0,1],['Z']]};
const shape={type:'shape',width:100,height:50,fill:'#669748',paths:[path]};
it('recognizes rectangular fills while retaining other drawing families',()=>{
 expect(supportsSolidRectangleDisplay({scene:shape})).toBe(true);
 const group={type:'group',width:100,height:100,childWidth:200,childHeight:200,children:[shape]};
 expect(supportsSolidRectangleDisplay({scene:group})).toBe(true);
 for(const change of [{text:{}},{shadow:{}},{outline:{}},{flipH:true},{shapeRotation:1},{fill:'#66974880'},{fill:{type:'linearGradient'}},{paths:[{...path,fillMode:'darkenLess'}]},{paths:[{...path,points:[['M',0,0],['L',1,0],['L',1,1],['Z']]}]}])expect(supportsSolidRectangleDisplay({scene:{...shape,...change}})).toBe(false);
 expect(supportsSolidRectangleDisplay({scene:{...group,childWidth:0}})).toBe(false);
 expect(supportsSolidRectangleDisplay({scene:shape,shadow:{}})).toBe(false);
});
it('retains local path offsets and accepts implicit or explicit rectangular closure',()=>{
 const points=[['M',2,3],['L',5,3],['L',5,7],['L',2,7]];
 for(const closure of [[],[['Z']],[['L',2,3],['Z']]])expect(rectanglePathBounds({width:10,height:10,points:[...points,...closure]},100,200)).toEqual({x:20,y:60,width:30,height:80});
 expect(rectanglePathBounds({points:[['M',0,0],['L',1,0],['Z'],['L',1,1],['L',0,1]]},1,1)).toBeUndefined();
 expect(rectanglePathBounds({...path,points:[['M',0,0],['L',1,1],['L',1,0],['L',0,1]]},100,50)).toBeUndefined();
});
it('preserves thin fills and projects extents independently of origin',()=>{
 const m={a:1,b:0,c:0,d:1,e:.75,f:.25};
 expect(solidRectangleDeviceFrame(m,1,{x:0,y:0,width:.5,height:24})).toEqual({x:1,y:0,width:1,height:24});
 // 22/15 is below 1.5 pixels even when the authored width is just above it.
 for(const width of [1.49995,1.50005])expect(solidRectangleDeviceFrame(m,1,{x:0,y:0,width,height:24}).width).toBe(1);
 expect(solidRectangleDeviceFrame(m,1,{x:0,y:0,width:23/15,height:24}).width).toBe(2);
 expect(solidRectangleDeviceFrame({...m,a:2,d:2},2,{x:0,y:0,width:1.5,height:24}).width).toBe(3);
 for(const phase of [0,.25,.49995,.75])expect(solidRectangleDeviceFrame({...m,e:phase},1,{x:0,y:0,width:1.5,height:24},true).width).toBe(phase===.75?1:2);
 for(const invalid of [{...m,b:1},{...m,a:-1},{...m,e:Infinity}])expect(solidRectangleDeviceFrame(invalid,1,{x:0,y:0,width:1,height:1})).toBeUndefined();
});
