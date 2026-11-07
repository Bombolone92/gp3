// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';

const html = s => cellsToHtml([['3']],[[{v:3,f:'1+2',s}]]);
it.each(['bt','bb','bl','br'])('retains %s side descriptors, formulas and values in a private clipboard snapshot',side=>{
 const s={[side]:true,[`${side}Border`]:{bc:'#123456',bs:'double'},bold:true};
 expect(parseHtmlClipboard(html(s)).cells).toEqual([[{v:3,f:'1+2',s}]]);
});
it('cleans unsafe side colors without discarding an otherwise valid cell snapshot',()=>{
 const s={bt:true,btBorder:{bc:'url(https://invalid.example/ink)',bs:'medium'},brBorder:{bc:null,bs:null}};
 const parsed=parseHtmlClipboard(html(s));
 expect(parsed.cells[0][0]).toEqual({v:3,f:'1+2',s:{bt:true,btBorder:{bs:'medium'},brBorder:{bc:null,bs:null}}});
 expect(s.btBorder.bc).toContain('url(');
});
it.each([{nested:{}}, {bc:{}}, {bs:[]}, JSON.parse('{"__proto__":{}}'), {constructor:'bad'}])('rejects malformed nested side descriptors %j',bad=>{
 const parsed=parseHtmlClipboard(html({bt:true,btBorder:bad}));
 expect(parsed.cells).toBeUndefined();expect(parsed.rows[0][0].text).toBe('3');
});
