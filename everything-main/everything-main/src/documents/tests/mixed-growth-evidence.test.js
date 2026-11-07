import{it,expect}from'vitest';import{JSDOM}from'jsdom';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{unzipSync,strFromU8}from'fflate';
const root='tests/fixtures/mixed-growth-preference/',native=JSON.parse(readFileSync(root+'native-widths.json','utf8').replace(/^\uFEFF/,'')),cases=JSON.parse(readFileSync(root+'cases.json'));
it('binds eight independently authored growth controls to native reference widths',()=>{
 for(const[f,h]of Object.entries(native.hashes))expect(createHash('sha256').update(readFileSync(root+f)).digest('hex')).toBe(h);
 expect(cases).toHaveLength(8);expect(native.widthsBeforePdf).toHaveLength(8);
 for(const row of native.widthsBeforePdf){expect(row).toHaveLength(4);expect(row.every(v=>Number.isFinite(v)&&v>0)).toBe(true);}
 expect(new Set(cases.map(c=>JSON.stringify(c))).size).toBe(8);
});
it('retains the declared table preference while independently varying merged footer preference',()=>{
 const xml=strFromU8(unzipSync(readFileSync(root+'control.docx'))['word/document.xml']);
 const dom=new JSDOM(xml,{contentType:'application/xml'}),w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const tables=[...dom.window.document.getElementsByTagNameNS(w,'tbl')];expect(tables).toHaveLength(8);
 tables.forEach((t,i)=>{
  const preference=t.getElementsByTagNameNS(w,'tblW')[0];expect(preference.getAttributeNS(w,'w')).toBe('6000');
  const rows=[...t.getElementsByTagNameNS(w,'tr')],footer=rows.at(-1).getElementsByTagNameNS(w,'tcW')[0];
  expect(footer.getAttributeNS(w,'type')).toBe(cases[i].mergedPreference?'dxa':'auto');expect(footer.getAttributeNS(w,'w')).toBe(cases[i].mergedPreference?'6000':'0');
  expect([...rows[2].getElementsByTagNameNS(w,'t')].slice(2).map(n=>n.textContent)).toEqual(cases[i].autoText);
 });dom.window.close();
 expect(cases.map(c=>c.mergedPreference)).toEqual([false,true,false,true,false,true,false,true]);
 for(let i=0;i<8;i+=2){expect(cases[i].marginTwips).toBe(cases[i+1].marginTwips);expect(cases[i].autoText).toEqual(cases[i+1].autoText);}
});
it('retains a separate native original-document guard without redistributing the corpus',()=>{
 const ref=JSON.parse(readFileSync(root+'corpus-reference.json'));expect(ref.points).toHaveLength(26);expect(ref.pageIndex).toBe(13);expect(ref.totalPages).toBe(18);expect(ref.sourceSha256).toMatch(/^[0-9a-f]{64}$/);expect(ref.nativePdfSha256).toMatch(/^[0-9a-f]{64}$/);
 const first=ref.points.filter(p=>p.y<300);expect(first).toHaveLength(13);expect(first.find(p=>p.text==='FEB').x).toBe(240.26);
});
