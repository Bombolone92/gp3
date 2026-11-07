import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {paintChart} from '../src/engine/canvas-charts.js';
import {TextDocument} from '../src/engine/model.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('public/fixtures/chart-metadata-auto.docx');
const refs=JSON.parse(readFileSync('tests/fixtures/chart-metadata/native-text.json','utf8'));
it.each(refs)('uses the native reference label families, emphasis and point sizes for $name',async r=>{
 const p=await DocxPackage.open(readFileSync(`${r.name==='chart-metadata-order'?'tests/fixtures/chart-metadata':'public/fixtures'}/${r.name}.docx`)),chart=Object.values(p.assets).find(a=>a.chart).chart,paint=[];
 const ctx={fontKerning:'none',save(){},restore(){},scale(){},measureText:t=>({width:t.length*6}),fillRect(){},strokeRect(){},fillText(text){paint.push({text,font:this.font,color:this.fillStyle});},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
 paintChart(ctx,chart,576,384);
 for(const ref of r.labels){
  const actual=paint.find(t=>t.text===ref.text);expect(actual).toBeDefined();
  const style=ref.text.startsWith('Q')?chart.categoryAxis.text:chart.valueAxis.text;
  expect(ref.font).toContain(style.fontAscii);expect(Math.abs(ref.size-style.fontSize)).toBeLessThan(.05);
  expect(/Bold/.test(ref.font)).toBe(style.bold);expect(/Italic/.test(ref.font)).toBe(style.italic);
  expect(actual.font).toContain(`"${style.fontAscii}"`);expect(actual.color).toBe('#'+style.color);
 }
});
it.each([
 ['automatic workbook updates',x=>x.replace('autoUpdate val="0"','autoUpdate val="1"')],
 ['visible data labels',x=>x.replace('showVal val="0"','showVal val="1"')],
 ['rounded chart frame',x=>x.replace('roundedCorners val="0"','roundedCorners val="1"')],
 ['missing explicit font defaults with chart style',x=>x.replaceAll('sz="900"','')],
 ['unsupported text rotation',x=>x.replaceAll('rot="-60000000"','rot="5400000"')],
 ['unknown extension',x=>x.replaceAll('C3380CC4-5D6E-409C-BE32-E72D297353CC','00000000-0000-0000-0000-000000000000')],
 ['incomplete numeric cache',x=>x.replace('<c:ptCount val="4"/>','<c:ptCount val="5"/>')],
 ['invalid date flag',x=>x.replace('date1904 val="1"','date1904 val="yes"')],
 ['unimplemented mixed-script label formatting',x=>x.replaceAll('Q1','季度一')],
])('rejects %s before editing',async(_,mutate)=>{
 const parts=unzipSync(source),path='word/charts/chart1.xml',s=strFromU8(parts[path]),changed=mutate(s);expect(changed).not.toBe(s);parts[path]=strToU8(changed);
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
it('never follows an external workbook relationship',async()=>{
 const parts=unzipSync(source),path='word/charts/_rels/chart1.xml.rels';parts[path]=strToU8(strFromU8(parts[path]).replace('Target="../embeddings/chart-data.xlsx"','Target="https://example.invalid/book.xlsx" TargetMode="External"'));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/external chart workbooks/);
});
it('rejects chart-local font themes even when every color is direct RGB',async()=>{
 const parts=unzipSync(source),chart='word/charts/chart1.xml',rels='word/charts/_rels/chart1.xml.rels';
 const xml=strFromU8(parts[chart]);expect(xml).toContain('+mn-lt');
 parts[chart]=strToU8(xml.replace(/<a:schemeClr\b[^>]*\/>|<a:schemeClr\b[^>]*>[\s\S]*?<\/a:schemeClr>/g,'<a:srgbClr val="336699"/>'));
 expect(strFromU8(parts[chart])).not.toContain('schemeClr');
 parts[rels]=strToU8(strFromU8(parts[rels]).replace('</Relationships>','<Relationship Id="fontTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeOverride" Target="font-theme.xml"/></Relationships>'));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/chart-local theme overrides/);
});
it('preserves tolerated invalid chart order through surrounding edits and undo',async()=>{
 const bytes=readFileSync('tests/fixtures/chart-metadata/chart-metadata-order.docx'),parts=unzipSync(bytes),pkg=await DocxPackage.open(bytes);
 const d=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const save=async()=>unzipSync(new Uint8Array(await pkg.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()));
 d.select(0);d.replace('EDIT ');const edited=await save();
 expectBodyEditParts(edited,parts);
 d.undo();const undone=await save();for(const n of Object.keys(parts))expect(Buffer.from(undone[n]).equals(Buffer.from(parts[n])),n).toBe(true);
});
