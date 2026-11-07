import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
const bytes=readFileSync('tests/fixtures/group-picture-shadows/control.docx');
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const effects=n=>[...(n.shadow?[n]:[]),...(n.children||[]).flatMap(effects)];
it('keeps each grouped shadow with its complete picture surface and resolves texture only once',async()=>{
 const pkg=await DocxPackage.open(bytes),scenes=Object.values(pkg.assets).filter(a=>a.scene).map(a=>a.scene);
 expect(scenes).toHaveLength(14);expect(effects(scenes[0])).toHaveLength(0);
 for(const scene of scenes.slice(1)){
  const [surface]=effects(scene);expect(effects(scene)).toHaveLength(1);
  expect(surface.shadowGeometry.paths.length).toBeGreaterThan(0);
  expect(surface.shadow.color).toEqual({rgb:'000000',alpha:.5});
 }
 expect(effects(scenes[2])[0].children).toHaveLength(2);
 expect(effects(scenes[12])[0].children).toHaveLength(2);
 expect(effects(scenes[6])[0].shadow.rotateWithShape).toBe(false);
 expect(effects(scenes[7])[0].shadow.rotateWithShape).toBe(true);
 expect(effects(scenes[9])[0].shadowGeometry.flipH).toBe(true);
 expect(Object.values(pkg.assets).filter(a=>a.bytes)).toHaveLength(1);
});
it.each([
 ['blurRad="0"','blurRad="-1"'],['rotWithShape="0"','rotWithShape="invalid"'],
 ['<a:outerShdw','<a:outerShdw sx="120000"'],['<a:outerShdw','<a:outerShdw kx="60000"'],
 ['outerShdw','glow'],
])('validates effects before the nested texture reader removes them: %s',async(before,after)=>{
 const parts=unzipSync(bytes),xml=strFromU8(parts['word/document.xml']);expect(xml).toContain(before);
 parts['word/document.xml']=strToU8(xml.replaceAll(before,after));await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
