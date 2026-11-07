import test from 'node:test';
import assert from 'node:assert/strict';
import {board,item,validateBoard} from '../src/model.js';
const {jiraIssues}=await import(process.env.WHITEBOARD_JIRA_CANDIDATE?'./jira-summary-unicode-candidate.js':'../src/planning/jira.js');
for(const length of [248,249,250])test(`Jira task summary retains complete Unicode at ${length} characters`,()=>{
 const text='Q'.repeat(length)+'😀\nOriginal description 😀';const b=board('Jira summary');b.items=[item('note',0,0,{text,lang:'fr-CA',textRuns:[{start:length,end:length+2,style:{lang:'en-GB'}}],task:{assignee:null,start:null,due:'2026-10-10',status:'todo'}})];validateBoard(structuredClone(b));const before=structuredClone(b);const issues=jiraIssues(b.items);assert.equal(issues.length,1);assert.equal(issues[0].summary,'Q'.repeat(length)+(length===248?'😀':''));assert.equal(issues[0].summary.isWellFormed(),true);assert.equal(issues[0].description,text);assert.equal(issues[0].due,'2026-10-10');assert.deepEqual(b,before);assert.equal(JSON.parse(JSON.stringify(issues))[0].summary,issues[0].summary);
});
