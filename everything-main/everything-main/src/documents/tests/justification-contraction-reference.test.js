import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/justification-contraction/';
const cases=JSON.parse(readFileSync(root+'cases.json'));
const ref=JSON.parse(readFileSync(root+'reference.json'));
it.each(Object.keys(cases))('pins the independent reference source, PDF and case labels: %s',name=>{
 const r=ref.documents[name];
 for(const [file,hash] of [[name+'.docx',r.sourceSha256],[name+'-native.pdf',r.pdfSha256]])expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(hash);
 expect(r.pages).toHaveLength(cases[name].cases.length);
 for(const [i,c] of cases[name].cases.entries())expect(r.pages[i][0].text).toBe(c.name.replace(/\s/gu,''));
});
const body=(name,label)=>ref.documents[name].pages[cases[name].cases.findIndex(c=>c.name===label)].slice(1).map(l=>l.text);
it('isolates modern final-line contraction and its font/whitespace boundaries',()=>{
 expect(body('edges','Calibri final')).toEqual(['a'.repeat(16)]);
 expect(body('edges-mode14','Calibri final')).toEqual(['a'.repeat(14),'aa']);
 expect(body('edges','Courier New final')).toEqual(['a'.repeat(14),'aa']);
 expect(body('edges','nbsp final')).toEqual(['a'.repeat(15),'a']);
 expect(body('edges','mixed-size final')).toEqual(['a'.repeat(16)]);
 expect(body('edges','mixed-mono final')).toEqual(['a'.repeat(14),'aa']);
 expect(body('edges-no-expand','soft final')).toEqual(body('edges','soft final'));
});
it('separates consecutive-space runs from the total-line limit',()=>{
 expect(body('clusters','count 1 fraction 0.24')).toHaveLength(1);
 expect(body('clusters','count 1 fraction 0.26')).toHaveLength(2);
 expect(body('limits','letters 2 count 2 fraction 0.32')).toHaveLength(1);
 expect(body('limits','letters 2 count 2 fraction 0.33')).toHaveLength(2);
 expect(body('limits','letters 4 count 2 fraction 0.49')).toHaveLength(1);
 expect(body('limits','letters 4 count 2 fraction 0.51')).toHaveLength(2);
 expect(ref.documents.clusters.pages.map(p=>p.map(l=>l.text))).toEqual(ref.documents['joined-clusters'].pages.map(p=>p.map(l=>l.text)));
});
