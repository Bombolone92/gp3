import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/theme-low-chroma-sweep/';
const cases=JSON.parse(readFileSync(root+'cases.json'));
const reference=JSON.parse(readFileSync(root+'reference.json'));
const saved=JSON.parse(readFileSync(root+'native-saved-colors.json'));
it('binds the complete low-chroma shade sweeps to native source and PDF',()=>{
 for(const[name,key]of [['control.docx','sourceSha256'],['cases.json','casesSha256'],['native.pdf','pdfSha256']])
  expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(reference[key]);
 expect(cases).toHaveLength(512);expect(reference.pages).toBe(15);
 expect(reference.colors.map(c=>c.label)).toEqual(cases.map(c=>c.label));
 for(const base of ['7F8080','80817F'])expect(cases.filter(c=>c.base===base).map(c=>c.value)).toEqual(Array.from({length:256},(_,i)=>i));
});
it('independently confirms the PDF colors using saved native RGB fallbacks',()=>{
 expect(saved.referenceBuild).toBe('16.0.20326');expect(saved.colors).toHaveLength(512);
 for(const [i,row]of saved.colors.entries()){
  expect(row.label).toBe(cases[i].label);
  expect([...Buffer.from(row.attributes.val,'hex')]).toEqual(reference.colors[i].rgb);
  expect(row.attributes.themeColor).toBe(cases[i].theme);
  if(cases[i].value===255)expect(row.attributes.themeShade).toBeUndefined();
  else expect(parseInt(row.attributes.themeShade,16)).toBe(cases[i].value);
 }
});
it('retains native witnesses contradicting a single shade-channel slope',()=>{
 const color=(base,value)=>reference.colors[cases.findIndex(c=>c.base===base&&c.value===value)].rgb;
 // Floor: modifier 2 needs k >= 1/2; modifier 86 needs k < 43/86 = 1/2.
 expect(color('7F8080',2)).toEqual([1,1,1]);expect(color('7F8080',86)).toEqual([42,43,43]);
 // Nearest: red at 128 needs k >= 63.5/128, while red at 44 needs k < 21.5/44.
 expect(color('80817F',128)).toEqual([64,64,63]);expect(color('80817F',44)).toEqual([21,22,21]);
 expect(127*88).toBeGreaterThan(43*256);
 // Even arbitrary final bias cannot fit the red channel's three observations.
 // From 2 to 44: k < (21-1+1)/42 = 1/2. From 44 to 128: k > (64-21-1)/84 = 1/2.
 expect(color('80817F',2)).toEqual([1,1,1]);
 expect((21-1+1)*84).toBe((64-21-1)*42);
});
