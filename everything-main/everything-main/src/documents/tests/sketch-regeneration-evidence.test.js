import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {unzipSync,strFromU8} from 'fflate';
const root='tests/fixtures/sketch-regeneration/';
const cases=JSON.parse(readFileSync(root+'cases.json','utf8')),geometry=JSON.parse(readFileSync(root+'geometry.json','utf8')),record=JSON.parse(readFileSync(root+'native-recording.json','utf8'));
const A='http://schemas.openxmlformats.org/drawingml/2006/main',PIC='http://schemas.openxmlformats.org/drawingml/2006/picture';
function paths(file){
 const dom=new JSDOM(strFromU8(unzipSync(readFileSync(root+file))['word/document.xml']),{contentType:'text/xml'});
 const result=[...dom.window.document.getElementsByTagNameNS(PIC,'pic')].map(pic=>[...pic.getElementsByTagNameNS(A,'pathLst')[0].children].map(p=>({attributes:Object.fromEntries([...p.attributes].map(a=>[a.name,a.value])),commands:[...p.children].map(n=>({type:n.localName,points:[...n.children].map(v=>[Number(v.getAttribute('x')),Number(v.getAttribute('y'))])}))})));
 dom.window.close();return result;
}
it('binds extracted native geometry to original controls and exact reference artifacts',()=>{
 for(const[name,hash]of Object.entries(record.hashes))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
 expect(cases).toHaveLength(16);expect(geometry.map(({paths,...c})=>c)).toEqual(cases);expect(geometry.map(c=>c.paths)).toEqual(paths('native.docx'));
});
it('records regenerated cubic paths for both picture stroke and fill rather than the authored cached rectangles',()=>{
 const source=paths('control.docx');expect(source).toHaveLength(16);
 for(const[i,c]of geometry.entries()){
  expect(c.paths).toHaveLength(2);expect(c.paths[0].attributes.fill).toBe('none');expect(c.paths[1].attributes.stroke).toBe('0');
  expect(c.paths).not.toEqual(source[i]);expect(c.paths[0].commands.filter(n=>n.type==='cubicBezTo')).toHaveLength(4);
  expect(c.paths[1].commands.filter(n=>n.type==='cubicBezTo')).toHaveLength(4);
 }
});
it('records deterministic repeated seeds, seed variation and dimension-dependent regeneration',()=>{
 expect(geometry[3].paths).toEqual(geometry[7].paths);expect(geometry[11].paths).toEqual(geometry[15].paths);
 for(const offset of [0,8]){expect(geometry[offset].paths).not.toEqual(geometry[offset+1].paths);expect(geometry[offset+1].paths).not.toEqual(geometry[offset+2].paths);}
 const curve=i=>geometry[i].paths[0].commands[1].points;
 expect(curve(3)).toEqual(curve(6));expect(curve(4)).toEqual(curve(5));
 expect(curve(4)).not.toEqual(curve(3).map(p=>p.map(v=>2*v)));
});
