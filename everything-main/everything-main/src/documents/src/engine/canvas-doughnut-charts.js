import { measureCanvasText, setCanvasTextStyle } from './canvas-text.js';

// Native reference controls establish 11pt automatic plot clearance. Explicit
// inner plot rectangles are fractions of the chart frame, with circular ink
// centered in the available rectangle rather than stretched into an ellipse.
export function doughnutFrame(chart, width, height) {
  const l=chart.layout, inset=11*4/3;
  const box=l?{x:l.x*width,y:l.y*height,width:l.w*width,height:l.h*height}:
    {x:inset,y:inset,width:Math.max(0,width-2*inset),height:Math.max(0,height-2*inset)};
  return {...box,cx:box.x+box.width/2,cy:box.y+box.height/2,radius:Math.min(box.width,box.height)/2};
}
export function doughnutSegments(chart) {
  return chart.series.map((series,index)=>{
    const sum=series.values.reduce((n,v)=>n+Math.abs(v),0);
    let start=(chart.angle-90)*Math.PI/180;
    const inner=chart.hole/100+(1-chart.hole/100)*index/chart.series.length;
    const outer=chart.hole/100+(1-chart.hole/100)*(index+1)/chart.series.length;
    return series.values.map((value,i)=>{
      const end=start+(sum?Math.abs(value)/sum*2*Math.PI:0);
      const segment={start,end,inner,outer,...series.points[i]};start=end;return segment;
    });
  });
}
export function paintDoughnutChart(ctx,chart,width,height) {
  const box=doughnutFrame(chart,width,height);
  const rectangle=(style,x,y,w,h)=>{
    if(style.fill){ctx.fillStyle=style.fill;ctx.fillRect(x,y,w,h);}
    if(style.line&&style.lineWidth){ctx.strokeStyle=style.line;ctx.lineWidth=style.lineWidth;ctx.strokeRect(x,y,w,h);}
  };
  ctx.save();ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();
  rectangle(chart.background,0,0,width,height);
  rectangle(chart.plot,box.x,box.y,box.width,box.height);
  for(const series of doughnutSegments(chart))for(const segment of series){
    const {start,end,inner,outer}=segment;if(end<=start||!box.radius)continue;
    const ri=inner*box.radius,ro=outer*box.radius;
    ctx.beginPath();ctx.arc(box.cx,box.cy,ro,start,end);
    if(end-start>=Math.PI*2-1e-12){ctx.closePath();ctx.moveTo(box.cx+ri*Math.cos(end),box.cy+ri*Math.sin(end));}
    else ctx.lineTo(box.cx+ri*Math.cos(end),box.cy+ri*Math.sin(end));
    ctx.arc(box.cx,box.cy,ri,end,start,true);ctx.closePath();
    if(segment.fill){ctx.fillStyle=segment.fill;ctx.fill();}
    if(segment.line&&segment.lineWidth){ctx.strokeStyle=segment.line;ctx.lineWidth=segment.lineWidth;ctx.lineJoin=segment.lineJoin||'round';ctx.stroke();}
  }
  if(chart.title){
    const title=chart.title,style=title.style,natural=measureCanvasText(ctx,title.text,style);
    const x=title.layout.x*width,y=title.layout.y*height;
    // Native chart-title controls vary size and position: 3pt side insets,
    // 1.5pt vertical insets, and the face's normal line-box ascent.
    rectangle(title.background,x,y,natural.width+8,natural.ascent+natural.descent+4);
    const scale=style.fontSize/1536;
    ctx.save();setCanvasTextStyle(ctx,{...style,fontSize:1536,kerning:style.kerning&&style.fontSize>=style.kerning?1:0});
    ctx.scale(scale,scale);ctx.fillStyle='#'+style.color;ctx.textAlign='left';ctx.textBaseline='alphabetic';
    ctx.fillText(title.text,(x+4)/scale,(y+2+natural.ascent)/scale);ctx.restore();
  }
  ctx.restore();
}
