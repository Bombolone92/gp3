import test from 'node:test';
import assert from 'node:assert/strict';
import {adminCall} from '../worker/admin.js';
import {environment,owner} from '../tests/collaboration-helpers.js';

test('feedback stores validated language snapshots with trimmed text and keeps anonymous reports',async()=>{
 const env=environment(),org=env.service.org;const call=(input)=>adminCall(org,env.service,owner,input);
 await call({op:'org.setup',name:'Feedback metadata audit'});
 const text='Start. Veuillez faciliter la navigation. End.';
 const frenchStart=text.indexOf('Veuillez'),frenchEnd=text.indexOf(' End.');
 await call({op:'feedback.submit',ease:4,comment:'  '+text+'  ',lang:'en-ca',textRuns:[{start:frenchStart+2,end:frenchEnd+2,style:{lang:'fr-ca'}}],context:'help'});
 const saved=[...env.data].filter(([key])=>key.startsWith('org:feedback:')).map(([,value])=>value)[0];
 assert.equal(saved.comment,text);assert.equal(saved.lang,'en-CA');assert.deepEqual(saved.textRuns,[{start:frenchStart,end:frenchEnd,style:{lang:'fr-CA'}}]);
 const report=await call({op:'org.reports',days:30});assert.equal(report.feedback.recent[0].lang,'en-CA');assert.deepEqual(report.feedback.recent[0].textRuns,saved.textRuns);
 assert.equal(report.feedback.recent[0].uuid,undefined);assert.equal(saved.uuid,undefined);
 for(const metadata of [{lang:'bad tag'},{textRuns:[{start:0,end:999,style:{lang:'fr'}}]},{textRuns:[{start:0,end:3,style:{bold:true}}]},{textRuns:[{start:0,end:3,style:{lang:'bad tag'}}]}])await assert.rejects(call({op:'feedback.submit',ease:3,comment:'Hello',...metadata}),{status:400});
 await call({op:'feedback.submit',ease:5,comment:'Legacy'});
 const legacy=[...env.data].filter(([key,value])=>key.startsWith('org:feedback:')&&value.comment==='Legacy')[0][1];assert.equal(legacy.lang,undefined);assert.equal(legacy.textRuns,undefined);
});
