// A beveled line join clips each outer rectangle corner by half the line width.
// Only the straight segments of an outlined rectangle are extruded, leaving
// the clipped corner side faces open. Native flat/deep controls distinguish this
// from a closed octagonal prism. Geometry is prepared once per picture.
export function clippedRectangle(width,height,depth,cut) {
  cut=Math.min(cut,width/2,height/2);
  const x=width/2,y=height/2;
  const boundary=[[-x+cut,-y],[x-cut,-y],[x,-y+cut],[x,y-cut],[x-cut,y],[-x+cut,y],[-x,y-cut],[-x,-y+cut]];
  return {boundary,intersect({origin,direction}){
    let best=null;
    const add=(t,normal,surface)=>{if(t>=0&&Number.isFinite(t)&&(!best||t<best.t))best={t,point:origin.map((v,i)=>v+t*direction[i]),normal,surface};};
    if(direction[2])for(const [z,n,s]of [[0,[0,0,1],'front'],[-depth,[0,0,-1],'back']]){
      if(n[2]*direction[2]>=0)continue;
      const t=(z-origin[2])/direction[2],px=Math.abs(origin[0]+t*direction[0]),py=Math.abs(origin[1]+t*direction[1]);
      if(px<=x+1e-8&&py<=y+1e-8&&px+py<=x+y-cut+1e-8)add(t,n,s);
    }
    if(depth)for(const axis of [0,1])if(direction[axis])for(const sign of [-1,1]){
      if(sign*direction[axis]>=0)continue;
      const extent=axis?y:x,t=(sign*extent-origin[axis])/direction[axis],z=origin[2]+t*direction[2],other=origin[1-axis]+t*direction[1-axis];
      if(z>=-depth-1e-8&&z<=1e-8&&Math.abs(other)<=(axis?x:y)-cut+1e-8)add(t,axis?[0,sign,0]:[sign,0,0],'side');
    }
    return best;
  }};
}
