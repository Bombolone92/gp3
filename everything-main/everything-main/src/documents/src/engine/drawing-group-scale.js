// A zero child-coordinate extent uses unit scale. A zero displayed
// extent also collapses child positions/frames before local rotation; those
// operations are distinct (see zero-axis-group-geometry native controls).
export const drawingGroupScale = (extent, childExtent) => childExtent === 0 ? 1 : extent / childExtent;
