import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
it('binds native pair positions to both independently authored compatibility modes',()=>{
 const folder='tests/fixtures/legacy-kerning-pairs/',ref=JSON.parse(readFileSync(folder+'reference.json')),cases=JSON.parse(readFileSync(folder+'cases.json'));
 expect(cases).toHaveLength(56);expect(ref.controls).toHaveLength(4);
 const hash=b=>createHash('sha256').update(b).digest('hex');
 for(const r of ref.controls){
  const bytes=readFileSync(folder+`control-${r.name}.docx`),parts=unzipSync(bytes);
  expect(hash(bytes)).toBe(r.sourceSha256);expect(hash(readFileSync(folder+`native-${r.name}.pdf`))).toBe(r.pdfSha256);
  expect(strFromU8(parts['word/settings.xml'])).toMatch(new RegExp(`enableOpenTypeFeatures[^>]+w:val="${r.enabled}"`));
  expect(r.lines).toHaveLength(56);
  r.lines.forEach((l,i)=>{expect(l.text.replace(/\s/g,'')).toBe(cases[i].text.replace(/\s/g,''));expect(l.page).toBe(cases[i].page);expect(Number.isFinite(l.x)&&Number.isFinite(l.y)).toBe(true);});
 }
 expect(Math.abs(ref.controls[0].lines[4].x-ref.controls[1].lines[4].x)).toBeGreaterThan(.8);
 expect(Math.abs(ref.controls[0].lines[7].x-ref.controls[1].lines[7].x)).toBeGreaterThan(.2);
});
