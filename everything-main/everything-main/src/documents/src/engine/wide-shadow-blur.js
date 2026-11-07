// Four samples per Gaussian sigma retain smooth density without repeatedly
// rounding intermediate alpha to bytes. The three-sigma support matches the
// DrawingML blur bounds; this is not the reference PDF's bitmap-resolution formula.
const SIGMA = 4, RADIUS = 12, PADDING = RADIUS + 1;
const weights = Array.from({length:2*RADIUS+1}, (_,i)=>Math.exp(-(((i-RADIUS)/SIGMA)**2)/2));
const total = weights.reduce((a,b)=>a+b,0);
const kernel = Float64Array.from(weights, v=>v/total);

export function blurWideShadowAlpha(data, width, height) {
  const horizontal = new Float32Array(width*height);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    let sum=0;
    for (let k=Math.max(-RADIUS,-x);k<=Math.min(RADIUS,width-1-x);k++) {
      sum+=data[4*(y*width+x+k)+3]*kernel[k+RADIUS];
    }
    horizontal[y*width+x]=sum;
  }
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    let sum=0;
    for (let k=Math.max(-RADIUS,-y);k<=Math.min(RADIUS,height-1-y);k++) {
      sum+=horizontal[(y+k)*width+x]*kernel[k+RADIUS];
    }
    data[4*(y*width+x)+3]=Math.round(sum);
  }
}

export function paintWideShadow(ctx, mask, source, shadow, {sx,sy,dx,dy,left,top,resolution}) {
  const sigma=shadow.blur/3, rasterScale=SIGMA/sigma;
  const x0=Math.min(source.left*sx,(source.left+source.width)*sx)+dx;
  const y0=Math.min(source.top*sy,(source.top+source.height)*sy)+dy;
  const width=Math.ceil(Math.abs(source.width*sx)*rasterScale)+2*PADDING;
  const height=Math.ceil(Math.abs(source.height*sy)*rasterScale)+2*PADDING;
  // The caller checks physical effect bounds before reaching this allocation.
  // At sigma >= 16 this mask uses at most a quarter sample per CSS pixel.
  const canvas=new OffscreenCanvas(width,height), c=canvas.getContext('2d',{willReadFrequently:true});
  c.imageSmoothingQuality='high';
  c.translate(PADDING+(dx-x0)*rasterScale,PADDING+(dy-y0)*rasterScale);
  c.scale(sx*rasterScale,sy*rasterScale);
  c.drawImage(mask,source.left,source.top,source.width,source.height);
  const image=c.getImageData(0,0,width,height), data=image.data;
  blurWideShadowAlpha(data,width,height);
  // Take color from the declared shadow, not unpremultiplication of a faint
  // edge pixel. Only alpha is convolved; colored shadows retain their hue.
  const rgb=shadow.color.rgb.match(/../g).map(v=>parseInt(v,16));
  for (let i=0;i<data.length;i+=4) { data[i]=rgb[0];data[i+1]=rgb[1];data[i+2]=rgb[2]; }
  c.putImageData(image,0,0);
  ctx.drawImage(canvas,(x0-PADDING/rasterScale-left)*resolution,
    (y0-PADDING/rasterScale-top)*resolution,width/rasterScale*resolution,height/rasterScale*resolution);
}
