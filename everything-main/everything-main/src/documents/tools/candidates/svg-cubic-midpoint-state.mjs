// Independent experimental midpoint state. Never imported by production.
// Native whole-curve fits do not justify its known split/broad regressions.
export function flattenSvgGroupCubic(input) {
  if(input.length!==4||input.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v)||Math.abs(v)>1e7)))return null;
  const scale=1024,p=input.map(p=>p.map(v=>Math.ceil(Math.fround(v)*16)/16*scale));
  const result=[p[0].map(v=>v/scale)];let failed=false;
  const half=(a,b)=>{const lower=Math.floor((a+b)/2);return (a+b)%2!==0&&lower%2!==0?lower+1:lower;};
  const midpoint=(a,b)=>a.map((v,k)=>half(v,b[k]));
  const visit=(p,depth=0)=>{
    const error=Math.max(...p[0].map((v,k)=>Math.abs(v-2*p[1][k]+p[2][k])),...p[1].map((v,k)=>Math.abs(v-2*p[2][k]+p[3][k])));
    if(error<=scale/4){result.push(p[3].map(v=>Math.floor(v/64+.5)/16));if(result.length>4096)failed=true;return;}
    if(depth>=16){failed=true;return;}
    const a=midpoint(p[0],p[1]),b=midpoint(p[1],p[2]),c=midpoint(p[2],p[3]);
    const d=midpoint(a,b),e=midpoint(b,c),f=midpoint(d,e);
    visit([p[0],a,d,f],depth+1);if(!failed)visit([f,e,c,p[3]],depth+1);
  };
  visit(p);return failed?null:result;
}
