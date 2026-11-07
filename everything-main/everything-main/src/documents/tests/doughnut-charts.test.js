import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {doughnutFrame,doughnutSegments} from '../src/engine/canvas-doughnut-charts.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('public/fixtures/doughnut-charts.docx');
const charts=p=>Object.values(p.assets).filter(a=>a.chart).map(a=>a.chart);
const C='http://schemas.openxmlformats.org/drawingml/2006/chart';
const node=(r,name)=>r.getElementsByTagNameNS(C,name)[0];
const changed=(index,change)=>{const parts=unzipSync(source),name=`word/charts/doughnut${index}.xml`,xml=new DOMParser().parseFromString(strFromU8(parts[name]),'application/xml');change(xml);parts[name]=strToU8(new XMLSerializer().serializeToString(xml));return zipSync(parts);};
it('reads independent native controls with signed values, concentric series and generated titles',async()=>{
 const all=charts(await DocxPackage.open(source));expect(all).toHaveLength(16);
 expect(all[8].series[0].values).toEqual([-1,2,-3,4]);
 expect(doughnutSegments(all[8])).toEqual(doughnutSegments(all[7]));
 expect(doughnutSegments(all[9])[0].every(s=>s.start===s.end)).toBe(true);
 expect(doughnutSegments(all[10]).map(s=>[s[0].inner,s[0].outer])).toEqual([[.5,.75],[.75,1]]);
 const frame=doughnutFrame(all[11],384,288);for(const [key,value]of Object.entries({cx:192,cy:158.4,radius:100.8}))expect(frame[key]).toBeCloseTo(value,8);
 expect(all[12].title).toMatchObject({text:'Orbit',style:{fontSize:14,bold:true,italic:true,fontAscii:'Arial'}});
 expect(all[13].title.text).toBe('Orbit');expect(all[14].title.style.fontSize).toBe(10);expect(all[15].title.style.fontSize).toBe(20);
});
it('retains cached charts and every unrelated part through editing, reopen and exact undo',async()=>{
 const p=await DocxPackage.open(source),before=charts(p),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.select(0);d.replace('EDIT ');const edited=await save();expect(charts(await DocxPackage.open(edited))).toEqual(before);
 expectBodyEditParts(unzipSync(edited),p.parts);
 d.undo();expect(unzipSync(await save())).toEqual(p.parts);
}, 60000);
it.each([
 ['small hole',r=>node(r,'holeSize').setAttribute('val','9')],
 ['large hole',r=>node(r,'holeSize').setAttribute('val','91')],
 ['invalid angle',r=>node(r,'firstSliceAng').setAttribute('val','361')],
 ['negative angle',r=>node(r,'firstSliceAng').setAttribute('val','-1')],
 ['fractional angle',r=>node(r,'firstSliceAng').setAttribute('val','1.5')],
 ['duplicate point',r=>node(r,'ser').appendChild(node(r,'dPt').cloneNode(true))],
 ['missing point',r=>node(r,'dPt').remove()],
 ['missing point paint',r=>node(node(r,'dPt'),'spPr').remove()],
 ['visible labels',r=>node(r,'showPercent').setAttribute('val','1')],
 ['nonfinite data',r=>node(node(r,'val'),'v').textContent='NaN'],
])('rejects unsupported or invalid doughnut data: %s',async(_,change)=>{
 let failure;try{await DocxPackage.open(changed(0,change));}catch(error){failure=error.name;}
 expect(failure).toBe('UnsupportedDocumentError');
});
it('requires manual coordinates and retains guards for unimplemented title layout',async()=>{
 for(const change of [r=>node(r,'x').remove(),r=>node(r,'xMode').setAttribute('val','factor')]){
  let failure;try{await DocxPackage.open(changed(12,change));}catch(error){failure=error.name;}
  expect(failure).toBe('UnsupportedDocumentError');
 }
});
it('lets a series explicitly disable a chart-level percentage label flag',async()=>{
 const bytes=changed(0,r=>{
  node(r,'showPercent').setAttribute('val','1');const labels=r.createElementNS(C,'c:dLbls'),flag=r.createElementNS(C,'c:showPercent');flag.setAttribute('val','0');labels.appendChild(flag);
  node(r,'ser').insertBefore(labels,node(r,'cat'));
 });
 expect(charts(await DocxPackage.open(bytes))[0].type).toBe('doughnut');
});
