// Rejected display-only experiment; never imported by the live renderer.
import {coupledSources as originalSources,baselineSources} from './border-coupled-experiment.mjs';
export {baselineRoute} from './border-coupled-experiment.mjs';
export function coupledSources(original,editor){
 const result=originalSources(original,editor);
 result.border=result.border.replace('const corners = new Map(), caps = [];',`const corners = new Map(), caps = [];
 const cellKey=(s,id)=>[s.tableId,s.pageStory,s.page,s.column??0,id].join(':');
 const tops=new Map(); for(const s of borders) if(s.horizontal&&!s.guide) for(const id of s.cellIds||[]) {const k=cellKey(s,id);tops.set(k,Math.min(tops.get(k)??Infinity,s.y));}`);
 result.border=result.border.replace('r.x = sx(s.x); r.y = sy(s.y);','r.x = sx(s.x-1/15); r.y = sy(s.y-1/15);');
 result.border=result.border.replace('sx(s.x + s.width) - r.x','sx(s.x + s.width-1/15) - r.x');
 result.border=result.border.replace('sy(s.y + s.height) - r.y','sy(s.y + s.height-1/15) - r.y');
 result.border=result.border.replace('if (s.bandEnds) r.bandEnds = s.bandEnds.map(pair => pair.map(v => s.horizontal ? sx(s.x + v) - r.x : sy(s.y + v) - r.y));',`if(s.horizontal&&s.side==='bottom'&&s.cellIds?.length===1){
 if(Math.floor(s.height*m.d+1e-6)===0){const top=tops.get(cellKey(s,s.cellIds[0]));
 r.y=Math.round(s.height*m.d)===0&&Number.isFinite(top)?sy(top-1/15)+(Math.round((s.y+s.height-top)*m.d)-1)/m.d:sy(s.y+s.height-1/15)-r.height;
 }else r.y=sy(s.y);
 } if (s.bandEnds) r.bandEnds = s.bandEnds.map(pair => pair.map(v => s.horizontal ? sx(s.x + v-1/15) - r.x : sy(s.y + v-1/15) - r.y));`);
 return result;
}
export async function coupledRoute(context){
 const baseline=baselineSources(),result=coupledSources(baseline.border,baseline.editor);
 await context.route('**/src/engine/border-device-layout.js*',r=>r.fulfill({body:result.border,contentType:'text/javascript'}));
 await context.route('**/src/engine/canvas-editor.js*',r=>r.fulfill({body:result.editor,contentType:'text/javascript'}));
}
