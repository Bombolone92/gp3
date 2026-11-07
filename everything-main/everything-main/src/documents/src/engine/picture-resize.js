import { WP, A, PIC } from './docx-images.js';
import { parseXml } from './docx-xml.js';
import { validateImage, imageExtents, rotationOutsets, CROP_SIDES } from './images.js';

const child=(n,ns,name)=>[...n?.children || []].find(c=>c.namespaceURI===ns&&c.localName===name);
function pictureFrame(image) {
  if(!image?.retainedDrawing || !image.shell || image.anchor?.relativeSize)return null;
  const drawing=parseXml(image.shell).documentElement;
  const frame=[...drawing.children].find(n=>n.namespaceURI===WP&&['anchor','inline'].includes(n.localName));
  const data=child(child(frame,A,'graphic'),A,'graphicData');
  const picture=data?.getAttribute('uri')===PIC&&child(data,PIC,'pic');
  return picture?{drawing,frame,picture}:null;
}
export const canResizeRetainedPicture=image=>!!pictureFrame(image);

/** Edit frame dimensions, preserving local geometry and physical effect parameters.
 * Re-reading this shell recomputes paths/clip/fill/outline/3D at the new dimensions.
 */
export function resizedPictureShell(image,width,height) {
  const source=pictureFrame(image);if(!source)throw new Error('Select a fixed-size standalone picture to resize.');
  const next={...image,width,height},oldRequired=rotationOutsets(image),nextRequired=rotationOutsets(next),oldExtent=imageExtents(image);
  next.effectExtent=Object.fromEntries(CROP_SIDES.map(side=>[side,nextRequired[side]+Math.max(0,oldExtent[side]-oldRequired[side])]));
  validateImage(next);
  if(image.aspectLocked && Math.abs(width*image.height/image.width-height)>1)throw new Error('This picture locks its aspect ratio.');
  const {drawing,frame,picture}=source,extent=child(frame,WP,'extent');
  extent.setAttribute('cx',String(width));extent.setAttribute('cy',String(height));
  const inner=child(child(child(picture,PIC,'spPr'),A,'xfrm'),A,'ext');
  if(inner){inner.setAttribute('cx',String(Math.max(1,Math.round(Number(inner.getAttribute('cx'))*width/image.width))));inner.setAttribute('cy',String(Math.max(1,Math.round(Number(inner.getAttribute('cy'))*height/image.height))));}
  let effects=child(frame,WP,'effectExtent');
  if(!effects){effects=drawing.ownerDocument.createElementNS(WP,`${frame.prefix?frame.prefix+':':''}effectExtent`);frame.insertBefore(effects,extent.nextSibling);}
  for(const side of CROP_SIDES)effects.setAttribute(side[0],String(next.effectExtent[side]));
  return {...next,shell:new XMLSerializer().serializeToString(drawing)};
}
