// Interior extrema of one scalar quadratic/cubic Bézier coordinate. Endpoints
// are included separately by the drawing walker. Control points are not ink.
export function bezierExtrema(values) {
  const [p0, p1, p2, p3] = values;
  const cubic = values.length === 4;
  let roots;
  if (!cubic) {
    const denominator = p0 - 2 * p1 + p2;
    roots = denominator === 0 ? [] : [(p0 - p1) / denominator];
  } else {
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
    if (a === 0) roots = b === 0 ? [] : [-c / b];
    else {
      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0) roots = [];
      else {
        // This form avoids cancellation when the two roots differ greatly.
        const q = -.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
        roots = q === 0 ? [-b / (2 * a)] : [q / a, c / q];
      }
    }
  }
  return roots.filter(t => t > 0 && t < 1).map(t => {
    const u = 1 - t;
    return cubic ? u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3 : u*u*p0 + 2*u*t*p1 + t*t*p2;
  });
}
