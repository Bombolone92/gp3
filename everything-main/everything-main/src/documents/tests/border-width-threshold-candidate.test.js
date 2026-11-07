import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {coupledSources} from '../tools/border-coupled-experiment.mjs';
const evidence=JSON.parse(readFileSync('tests/fixtures/measurements/border-width-threshold.json'));
const sha=data=>createHash('sha256').update(data).digest('hex');
it('binds the rejected width-threshold source and independent native edge evidence',()=>{
 const baseline=readFileSync('tests/fixtures/border-shared-origin/baseline-border-device-layout.js','utf8'),editor=readFileSync('tests/fixtures/border-shared-origin/baseline-canvas-editor.js','utf8');
 expect(sha(baseline.replace(/\r\n/g,'\n'))).toBe(evidence.baselineBorderCanonicalSha256);
 expect(sha(editor.replace(/\r\n/g,'\n'))).toBe(evidence.baselineEditorCanonicalSha256);
 const candidate=coupledSources(baseline,editor,{widthThreshold:true});
 expect(sha(candidate.border.replace(/\r\n/g,'\n'))).toBe(evidence.candidateCanonicalSha256);
 expect(sha(readFileSync(evidence.nativeEdgeEvidence,'utf8').replace(/\r\n/g,'\n'))).toBe(evidence.nativeEdgeEvidenceCanonicalSha256);
 expect(evidence.summary).toMatchObject({experiment:'coupled-width-threshold',edges:2048,improved:877});
 expect(evidence.summary.regressions).toHaveLength(16);
 for(const row of evidence.summary.regressions){expect(row.zoom).toBe(100);expect(row.edge).toBe(3);expect(row.baseline).toBe(row.native);expect(row.candidate).toBe(row.native-1);}
 expect(()=>coupledSources(baseline,editor,{floorBottom:true,widthThreshold:true})).toThrow('Choose one');
});
it('rejects the coarse print-grid fit at independently captured fine phases',()=>{
 const folder='tests/fixtures/border-dense-phase/',ref=JSON.parse(readFileSync(folder+'reference.json'));
 const cases=JSON.parse(readFileSync(folder+'cases.json'));
 expect(sha(readFileSync(folder+'control.docx'))).toBe(ref.sourceSha256);
 const bounds=id=>{const rectangles=ref.rectangles.slice((id-1)*12,id*12);return [Math.min(...rectangles.map(r=>r[0])),Math.min(...rectangles.map(r=>r[1])),Math.max(...rectangles.map(r=>r[0]+r[2])),Math.max(...rectangles.map(r=>r[1]+r[3]))];};
 expect(bounds(29)[1]).toBe(853);expect(Math.floor(cases[28].yTwips*5/12)).toBe(852);
 const c=cases[8];expect(bounds(9)[3]).toBe(403);
 expect(Math.floor((2*c.yTwips+2*c.heightTwips+5*c.size)*5/24)).toBe(402);
});
it('does not accept exact shared-edge crops as proof of a safe general correction',()=>{
 expect(evidence.sharedCropMetrics).toHaveLength(4);
 for(const row of evidence.sharedCropMetrics){expect(row.metrics.baseline.differing).toBe(row.zoom===100?627:954);expect(row.metrics.coupled).toEqual({differing:0,worse:[]});}
 expect(evidence.status).toBe('rejected');
});
