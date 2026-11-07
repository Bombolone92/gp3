// The child frame is resized before rotation, exchanging the ancestor scale
// axes around quarter turns. The frame's center keeps its original position.
export function drawingRotationMatrix(node, sx, sy, rotation) {
  const degrees = rotation / 60000;
  const swap = degrees >= 45 && degrees < 135 || degrees >= 225 && degrees < 315;
  const angle = degrees * Math.PI / 180;
  const snap = value => Math.abs(value) < 1e-12 ? 0 : value;
  const cos = snap(Math.cos(angle)), sin = snap(Math.sin(angle));
  const a = cos * (swap ? sy : sx), b = sin * (swap ? sy : sx);
  const c = -sin * (swap ? sx : sy), d = cos * (swap ? sx : sy);
  return [a, b, c, d, (node.width * sx - a * node.width - c * node.height) / 2,
    (node.height * sy - b * node.width - d * node.height) / 2];
}

export function pictureRotationMatrix(node, sx, sy) {
  return drawingRotationMatrix(node, sx, sy, node.pictureRotation);
}

// A collapsed frame has no measurable direction on one axis. Preserve the
// surviving axis and its perpendicular instead of dividing a zero column.
export function drawingOrientation([a,b,c,d,e=0,f=0], handedness=1) {
  const sx=Math.hypot(a,b), sy=Math.hypot(c,d);
  const sign=handedness<0 ? -1 : 1;
  return [sx ? a/sx : sy ? sign*d/sy : 1, sx ? b/sx : sy ? -sign*c/sy : 0,
    sy ? c/sy : sx ? -sign*b/sx : 0, sy ? d/sy : sx ? sign*a/sx : sign,e,f];
}

// Compose a local frame rotation with the ancestor's orientation. Column
// lengths retain physical scale even when the ancestor axes are rotated.
export function composeDrawingRotation(node, matrix, rotation, handedness=1) {
  const [a,b,c,d,e,f] = matrix, sx = Math.hypot(a,b), sy = Math.hypot(c,d);
  const [oa,ob,oc,od]=drawingOrientation(matrix,handedness);
  const [ra,rb,rc,rd,re,rf] = drawingRotationMatrix(node,sx,sy,rotation);
  return [oa*ra+oc*rb,ob*ra+od*rb,
    oa*rc+oc*rd,ob*rc+od*rd,
    e+oa*re+oc*rf,f+ob*re+od*rf];
}
