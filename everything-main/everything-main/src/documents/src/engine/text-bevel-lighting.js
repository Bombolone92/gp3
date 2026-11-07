// Adjoining text-bevel faces are smoothed below a 30-degree contour turn.
// Weight their normals by face area (proportional to edge length for a fixed
// bevel width). Sharp corners retain independent normals on either side.
export function bevelLightingNormals(contour, slope) {
  const edges = contour.map((p, i) => {
    const q = contour[(i + 1) % contour.length], x = q.x - p.x, y = q.y - p.y;
    const length = Math.hypot(x, y);
    return { length, x: y / length * slope, y: -x / length * slope,
      tangent: [x / length, y / length] };
  });
  const corner = (a, b, own) => {
    if (a.tangent[0] * b.tangent[0] + a.tangent[1] * b.tangent[1] <= Math.cos(Math.PI / 6))
      return [own.x, own.y, 1];
    const length = a.length + b.length;
    return [(a.x * a.length + b.x * b.length) / length,
      (a.y * a.length + b.y * b.length) / length, 1];
  };
  return edges.map((edge, i) => [
    corner(edges[(i + edges.length - 1) % edges.length], edge, edge),
    corner(edge, edges[(i + 1) % edges.length], edge),
  ]);
}
