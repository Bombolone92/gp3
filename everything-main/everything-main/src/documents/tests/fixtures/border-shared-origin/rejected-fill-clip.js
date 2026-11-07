// REJECTED DIAGNOSTIC ONLY: bounds improve but native full-crop pixels regress.
export function displacedRightFillLimits(ctx, cells, logical, device) {
 const m=ctx.getTransform?.();const limits=new Map();
 if(!m||m.b||m.c||!(m.a>0&&m.d>0))return limits;
 const byId=new Map();
 for(const cell of cells)if(cell.fill){if(!byId.has(cell.id))byId.set(cell.id,[]);byId.get(cell.id).push(cell);}
 for(let i=0;i<logical.length;i++){
  const s=logical[i],r=device[i];
  if(s.guide||s.horizontal||s.border.style!=='single'||Math.floor(s.width*m.a+1e-6)!==0)continue;
  const center=s.x+s.width/2,right=r.x+r.width;
  for(const id of s.cellIds||[])for(const cell of byId.get(id)||[]){
   if(Math.abs(cell.x+cell.width-center)>1e-6||right>=cell.x+cell.width)continue;
   const top=Math.max(cell.y, r.y),bottom=Math.min(cell.y+cell.height,r.y+r.height);
   if(bottom<=top)continue;
   if(!limits.has(cell))limits.set(cell,[]);
   limits.get(cell).push({top,bottom,right});
  }
 }
 return limits;
}
export function clippedFillRects(left,top,right,bottom,limits) {
 if(!(right>left&&bottom>top))return [];
 if(!limits?.length)return [[left,top,right-left,bottom-top]];
 const events=new Map(),add=(at,event)=>{if(!events.has(at))events.set(at,[]);events.get(at).push(event);};
 add(top,null);add(bottom,null);
 for(const limit of limits){const a=Math.max(top,limit.top),b=Math.min(bottom,limit.bottom);if(b>a&&limit.right<right){add(a,{right:limit.right,change:1});add(b,{right:limit.right,change:-1});}}
 const stops=[...events.keys()].sort((a,b)=>a-b),active=new Map(),rects=[];
 for(let i=0;i<stops.length-1;i++){
  const y=stops[i],end=stops[i+1];for(const event of events.get(y))if(event){const count=(active.get(event.right)||0)+event.change;if(count)active.set(event.right,count);else active.delete(event.right);}
  const edge=Math.min(right,...active.keys());if(edge<=left)continue;
  const last=rects.at(-1);if(last&&last[0]===left&&last[2]===edge-left&&last[1]+last[3]===y)last[3]=end-last[1];else rects.push([left,y,edge-left,end-y]);
 }
 return rects;
}
