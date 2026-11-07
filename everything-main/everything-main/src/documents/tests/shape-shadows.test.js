import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
const bytes=readFileSync('tests/fixtures/shape-shadows/control.docx');
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
it('resolves effect matrix entries, direct overrides and placeholder colors',async()=>{
 const pkg=await DocxPackage.open(bytes),scenes=Object.values(pkg.assets).map(a=>a.scene);
 const shape=i=>scenes[i].children?.[0]||scenes[i];
 expect(scenes).toHaveLength(20);
 for(const i of [0,2,4])expect(shape(i).shadow).toBeUndefined();
 expect(shape(1).shadow).toMatchObject({x:16,y:0,blur:16/3,color:{rgb:'000000',alpha:.5},rotateWithShape:false});
 expect(shape(3).shadow.color.rgb).toBe('8040C0');
 expect(shape(3).shadow).toEqual(shape(5).shadow);
 expect(shape(7).shadow.rotateWithShape).toBe(true);expect(shape(8).shadow).toEqual(shape(7).shadow);
 expect(shape(11).shadow).toEqual(shape(1).shadow);
 expect(shape(18).shadow.color).toEqual({rgb:'604333',alpha:.5});
 expect(shape(19).text.paragraphs[0].runs[0].text).toBe('Shadow text');
});
it.each([
 ['blurRad="50800"','blurRad="-1"'],['rotWithShape="0"','rotWithShape="bad"'],
 ['<a:outerShdw','<a:outerShdw sx="120000"'],
 ['<a:outerShdw','<a:outerShdw kx="60000"'],
 ['<a:effectRef idx="1"','<a:effectRef idx="99"'],
])('guards invalid or unsupported effects %s',async(before,after)=>{
 const parts=unzipSync(bytes);let changed=0;
 for(const name of ['word/document.xml','word/theme/probe.xml']){
  const xml=strFromU8(parts[name]);changed+=xml.includes(before)?1:0;parts[name]=strToU8(xml.replaceAll(before,after));
 }
 expect(changed).toBeGreaterThan(0);await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
