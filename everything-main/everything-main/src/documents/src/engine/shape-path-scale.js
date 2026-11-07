// An omitted DrawingML path viewport uses shape-coordinate EMUs. Its default
// can be zero on a flat custom shape; this is an identity, not a 0/0 scale.
export const shapePathScale = (extent, viewport) => viewport === 0 ? 1 : extent / viewport;
