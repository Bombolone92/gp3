import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutShapeText} from '../src/engine/canvas-shapes.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('matches the native reference edge-spacing baselines for top, center, bottom and multiple paragraphs under all three flags',async()=>{
 const p=await DocxPackage.open(readFileSync('public/fixtures/shape-edge-spacing.docx'));
 const ref=JSON.parse(readFileSync('tests/fixtures/shape-edge-spacing/reference.json'));
 const shapes=Object.values(p.assets).map(a=>a.scene),before=structuredClone(shapes);expect(shapes).toHaveLength(21);
 for(const[i,c]of ref.cases.entries()){
  const result=layoutShapeText(shapes[i],text=>({width:text.length*14,ascent:25,descent:7}));
  expect(result.layout.lines).toHaveLength(c.count);
  result.layout.lines.forEach((l,j)=>expect(Math.abs(c.y+(result.top+result.shift+l.baseline)*.75-c.baselines[j]),c.id).toBeLessThan(.15));
 }
 expect(shapes).toEqual(before);
});
