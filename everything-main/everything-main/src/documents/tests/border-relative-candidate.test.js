import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {coupledSources} from '../tools/border-relative-experiment.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>sha(x.replace(/\r\n/g,'\n'));
const evidence=JSON.parse(readFileSync('tests/fixtures/measurements/border-relative-regions.json'));
it('rejects an edge-improving candidate using complete frame regions',()=>{
 const border=readFileSync('tests/fixtures/border-shared-origin/baseline-border-device-layout.js','utf8'),editor=readFileSync('tests/fixtures/border-shared-origin/baseline-canvas-editor.js','utf8');
 expect(canonical(border)).toBe(evidence.baselineBorderCanonicalSha256);
 expect(canonical(editor)).toBe(evidence.baselineEditorCanonicalSha256);
 expect(canonical(coupledSources(border,editor).border)).toBe(evidence.candidateCanonicalSha256);
 expect(evidence.edgeSummary).toEqual({experiment:'coupled-relative',edges:2048,improved:884,regressions:[]});
 expect(evidence.regions).toBe(512);
 expect(evidence.blackWorse).toBe(69);expect(evidence.redWorse).toBe(2);
 expect(evidence.observations.reduce((sum,o)=>sum+o.metrics.black.worse,0)).toBe(69);
 expect(evidence.observations.reduce((sum,o)=>sum+(o.metrics.red?.worse||0),0)).toBe(2);
 expect(evidence.status).toBe('rejected');
});
it('binds both refreshed native corners and retains the original captures',()=>{
 const path='tests/fixtures/border-phase/',bytes=readFileSync(path+'native-clean-corners-reference.json');
 expect(sha(bytes)).toBe(evidence.cleanReferenceSha256);
 const ref=JSON.parse(bytes);
 expect(ref.observations).toHaveLength(2);
 for(const o of ref.observations){
  expect(sha(readFileSync(path+o.source))).toBe(o.sourceSha256);
  expect(sha(readFileSync(path+o.crop))).toBe(o.cropSha256);
  expect(sha(readFileSync(path+o.previousCrop))).toBe(o.previousCropSha256);
  expect(o.sourceUnchanged).toBe(true);
 }
 expect(ref.observations[0].blackMaskChanges).toEqual([
  {x:30,y:30,previousBlack:false,cleanBlack:true},
  {x:30,y:31,previousBlack:true,cleanBlack:false},
 ]);
 expect(ref.observations[1].blackMaskChanges).toEqual([
  {x:36,y:37,previousBlack:true,cleanBlack:false},
  {x:38,y:37,previousBlack:true,cleanBlack:false},
 ]);
});
