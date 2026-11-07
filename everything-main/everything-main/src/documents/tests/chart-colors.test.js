import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('public/fixtures/chart-theme-colors.docx');
const refs=JSON.parse(readFileSync('tests/fixtures/chart-colors/reference.json','utf8'));
it.each(refs)('resolves $name axis/grid luminance colors exactly as the native reference',async r=>{
 const pkg=await DocxPackage.open(readFileSync(`public/fixtures/${r.name}.docx`));
 const chart=Object.values(pkg.assets).find(a=>a.chart).chart;
 expect(chart.categoryAxis.line).toBe('#d9d9d9');expect(chart.valueAxis.grid).toBe('#7f7f7f');
 for(const color of [chart.categoryAxis.line,chart.valueAxis.grid]){
  expect(r.strokeColors).toContain(color);
 }
});
it.each([
 ['conflicting colors',x=>x.replace('<a:schemeClr val="accent1">','<a:srgbClr val="FFFFFF"/><a:schemeClr val="accent1">')],
 ['unknown theme slot',x=>x.replace('val="accent1"','val="accent7"')],
 ['unresolved placeholder',x=>x.replace('val="accent1"','val="phClr"')],
 ['alpha requiring composition',x=>x.replace('<a:shade val="65000"/>','<a:alpha val="50000"/>')],
 ['unsupported color transform',x=>x.replace('<a:shade val="65000"/>','<a:hueOff val="60000"/>')],
 ['nonempty effects',x=>x.replace('<a:effectLst/>','<a:effectLst><a:blur rad="9525"/></a:effectLst>')],
 ['invalid transform range',x=>x.replace('val="65000"','val="100001"')],
])('keeps %s out of the editable subset',async(_,mutate)=>{
 const parts=unzipSync(source),path='word/charts/chart1.xml',original=strFromU8(parts[path]),changed=mutate(original);
 expect(changed).not.toBe(original);parts[path]=strToU8(changed);
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
it('does not silently substitute the parent theme for a chart-local override',async()=>{
 const parts=unzipSync(source);
 parts['word/charts/_rels/chart1.xml.rels']=strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="theme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeOverride" Target="../theme/themeOverride1.xml"/></Relationships>');
 parts['word/theme/themeOverride1.xml']=strToU8('<a:themeOverride xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>');
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/chart-local theme overrides/);
});
