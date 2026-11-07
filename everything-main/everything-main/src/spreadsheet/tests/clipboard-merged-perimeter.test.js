// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { parseHtmlClipboard } from '../src/core/clipboard.js';

it('distributes a spanning HTML cell\'s side borders to its spreadsheet perimeter',()=>{
 const p=parseHtmlClipboard('<table><tr><td rowspan="3" colspan="2" style="border-top:1px solid red;border-bottom:3px double blue;border-left:2px dashed green;border-right:3px solid black">Merged</td></tr><tr></tr><tr></tr></table>');
 expect(p.merges).toEqual([{r1:0,c1:0,r2:2,c2:1}]);
 expect(p.rows[0][0].text).toBe('Merged');
 const flags=cell=>Object.keys(cell.style||{}).filter(k=>['bt','bb','bl','br'].includes(k)&&cell.style[k]).sort();
 expect(p.rows.map(row=>row.map(flags))).toEqual([
  [['bl','bt'],['br','bt']],[['bl'],['br']],[['bb','bl'],['bb','br']],
 ]);
 expect(p.rows[2][0].style.bbBorder).toEqual({bs:'double',bc:'#0000ff'});
 expect(p.rows[1][1].style.brBorder).toEqual({bs:'thick',bc:'#000000'});
 expect(p.rows[1][0].text).toBe('');
 p.rows[0][0].style.btBorder.bc='#123456';
 expect(p.rows[0][1].style.btBorder.bc).toBe('#ff0000');
});

it.each(['rowspan="2"','colspan="2"'])('retains sides on single-axis spans (%s)',span=>{
 const p=parseHtmlClipboard(`<table><tr><td ${span} style="border:1px solid #123456">Merged</td></tr><tr></tr></table>`);
 const m=p.merges[0];
 for(let c=m.c1;c<=m.c2;c++){expect(p.rows[m.r1][c].style.bt).toBe(true);expect(p.rows[m.r2][c].style.bb).toBe(true);}
 for(let r=m.r1;r<=m.r2;r++){expect(p.rows[r][m.c1].style.bl).toBe(true);expect(p.rows[r][m.c2].style.br).toBe(true);}
});

it('propagates explicit cleared sides and preserves neighboring cells',()=>{
 const p=parseHtmlClipboard('<table><tr><td colspan="2" rowspan="2" style="border:none">Merged</td><td style="border:2px solid red">Neighbor</td></tr><tr><td>Other</td></tr></table>');
 expect(p.rows[1][0].style.bb).toBe(false);expect(p.rows[1][1].style.br).toBe(false);
 expect(p.rows[0][2].style.btBorder).toEqual({bs:'medium',bc:'#ff0000'});
 expect(p.rows[1][2].style).toBeUndefined();
});
