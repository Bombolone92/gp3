// Page-relative sizing resizes each local frame before its rotation. It is
// distinct from a group's coordinate transform (which exchanges scale axes
// around quarter turns). Retain geometry coordinates, text and physical pens.
export function resizeShapeFrame(node, sx, sy) {
  const frame = {...node,x:node.x*sx,y:node.y*sy,width:node.width*sx,height:node.height*sy};
  if (node.type === 'group') Object.assign(frame, {
    childX:node.childX*sx,childY:node.childY*sy,
    childWidth:node.childWidth*sx,childHeight:node.childHeight*sy,
    children:node.children.map(child=>resizeShapeFrame(child,sx,sy)),
  });
  return frame;
}
