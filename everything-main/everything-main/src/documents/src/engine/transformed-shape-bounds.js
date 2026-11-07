import { shapePathScale } from './shape-path-scale.js';
import { outlinePadding } from './drawing-line-ends.js';
import { EMU_PER_PX } from './images.js';
import { bezierExtrema } from './bezier-bounds.js';
import { pictureOutlineContours } from './picture-outline-offset.js';

// Transform curve controls before finding extrema: extrema along the original
// axes do not necessarily bound a rotated curve.
export function transformedShapeBounds(node, matrix) {
  const [a,b,c,d,e,f]=matrix;
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  const include=(x,y,ex,ey)=>{left=Math.min(left,x-ex);right=Math.max(right,x+ex);top=Math.min(top,y-ey);bottom=Math.max(bottom,y+ey);};
  for(const path of node.paths){
    if (node.pictureOutline && node.outline && path.stroke) {
      const sx = node.flipH ? -1 : 1, sy = node.flipV ? -1 : 1;
      const ox = node.flipH ? node.width : 0, oy = node.flipV ? node.height : 0;
      const m = { a:a*sx, b:b*sx, c:c*sy, d:d*sy, e:a*ox+c*oy+e, f:b*ox+d*oy+f };
      const pen = node.outline.width / EMU_PER_PX;
      const offsetPen = (node.outline.declaredWidth ?? node.outline.width) / EMU_PER_PX;
      const edge = pen / 2 * Math.max(node.outline.cap === 'sq' ? Math.SQRT2 : 1, node.outline.join === 'miter' ? node.outline.miterLimit : 1);
      for (const contour of pictureOutlineContours(path,node.width,node.height,m,4/3,offsetPen)) for (const p of contour) include(...p,edge,edge);
      continue;
    }
    const edge=path.stroke?outlinePadding(node.outline,true,path):0;
    const ex=edge/EMU_PER_PX,ey=ex;
    const point=(px,py)=>{
      const x=(node.flipH?path.width-px:px)*shapePathScale(node.width, path.width),y=(node.flipV?path.height-py:py)*shapePathScale(node.height, path.height);
      return [a*x+c*y+e,b*x+d*y+f];
    };
    let current=point(0,0),start=current;
    for(const cmd of path.points){
      if(cmd[0]==='E'){
        const [x,y]=point(path.width/2,path.height/2);
        const rx=Math.hypot(a*node.width/2,c*node.height/2),ry=Math.hypot(b*node.width/2,d*node.height/2);
        include(x,y,rx+ex,ry+ey);
      }else if(cmd[0]==='Z')current=start;
      else{
        const points=[current];for(let i=1;i<cmd.length;i+=2)points.push(point(cmd[i],cmd[i+1]));
        const end=points.at(-1);include(...end,ex,ey);
        if(cmd[0]==='C'||cmd[0]==='Q'){
          for(const x of bezierExtrema(points.map(p=>p[0])))include(x,end[1],ex,ey);
          for(const y of bezierExtrema(points.map(p=>p[1])))include(end[0],y,ex,ey);
        }
        current=end;if(cmd[0]==='M')start=end;
      }
    }
  }
  return {left,top,right,bottom};
}
