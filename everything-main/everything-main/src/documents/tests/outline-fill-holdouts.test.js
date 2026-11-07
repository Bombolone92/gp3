import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
const folder='tests/fixtures/outline-fill-holdouts/';
const ref=JSON.parse(readFileSync(folder+'reference.json'));
const hash=b=>createHash('sha256').update(b).digest('hex');
it('binds native source, case declarations and all 64 screen regions',()=>{
  for(const [name,source] of Object.entries(ref.sources)){
    expect(hash(readFileSync(folder+name+'.docx'))).toBe(source.sha256);
    expect(hash(readFileSync(folder+name+'-cases.json'))).toBe(source.casesSha256);
  }
  expect(ref.observations).toHaveLength(4);
  for(const o of ref.observations){expect(o.regions).toHaveLength(16);expect(hash(readFileSync(folder+o.crop))).toBe(o.cropSha256);expect(o.originalFormat).toBe('JPEG');}
});
it.each(['combined','group'])('imports %s geometry and retains every source part',async name=>{
  const dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
  try{
    const bytes=readFileSync(folder+name+'.docx'),pkg=await DocxPackage.open(bytes);
    expect(pkg.readOnly).not.toBe(true);
    const scenes=Object.values(pkg.assets).map(a=>a.scene);expect(scenes).toHaveLength(16);
    for(const scene of scenes){
      if(name==='combined'){expect(scene.type).toBe('shape');expect(scene.fill).toBe('#D5D5D5');expect(scene.outline.width).toBe(4327);}
      else{expect(scene.type).toBe('group');expect(scene.children).toHaveLength(2);expect(scene.children[0].fill).toBe('#D5D5D5');expect(scene.children[0].outline).toBeNull();expect(scene.children[1].outline.width).toBe(4327);}
    }
    expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
  }finally{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;}
},60000);
