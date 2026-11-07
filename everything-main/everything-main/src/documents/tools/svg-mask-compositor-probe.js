// Diagnostic fragment, appended to the existing group module by the probe.
// Not imported by the renderer. Only the independently authored rectangles
// are supported; curves, images, gradients and mask-coordinate integration
// remain outside this numerical investigation.
export function probeNativeRender(node) {
 const description=describe(node,{samples:0,layers:0});
 if(!description||description.empty)return null;
 const box=roundedBounds(description.box),pixels=new Uint8ClampedArray(box.width*box.height*4);
 const alphaByte=new Uint8ClampedArray(1);
 function over(pixels,at,color,alpha,sourceChannels=null) {
  if(!alpha)return;
  const old=pixels[at+3],out=alpha+Math.round(old*(255-alpha)/255),inverse=Math.floor(255*65536/out);
  for(let k=0;k<3;k++) {
   const destination=Math.round(pixels[at+k]*old/255),source=sourceChannels?sourceChannels[k]:Math.round(color[k]*alpha/255);
   pixels[at+k]=Math.floor((source+Math.round(destination*(255-alpha)/255))*inverse/65536);
  }
  pixels[at+3]=out;
 }
 function paint(d,pixels) {
  if(d.children) {
   if(d.opacity===1){for(const child of d.children)paint(child,pixels);return;}
   const layer=new Uint8ClampedArray(pixels.length);
   for(const child of d.children)paint(child,layer);
   for(let i=0;i<pixels.length;i+=4){
    layer[i+3]=Math.round(layer[i+3]*Math.round(d.opacity*255)/255);
    if(!pixels[i+3])pixels.set(layer.subarray(i,i+4),i);
    else over(pixels,i,layer.subarray(i,i+3),layer[i+3]);
   }
   return;
  }
  if(!d.rectangle)throw Error('Probe only supports original rectangle controls');
  const brushAlpha=Math.floor(d.opacity*255+1e-10),premultiplied=d.color.map(c=>Math.round(c*brushAlpha/255));
  for(let y=0;y<box.height;y++)for(let x=0;x<box.width;x++){
   const b=d.box,count=coveredSamples(b.x,b.x+b.width,box.x+x,8)*coveredSamples(b.y,b.y+b.height,box.y+y,4);
   alphaByte[0]=Math.round(count*brushAlpha/32);
   over(pixels,(y*box.width+x)*4,d.color,alphaByte[0],premultiplied.map(c=>Math.round(c*count/32)));
  }
 }
 paint(description,pixels);
 return {...box,pixels:[...pixels]};
}
