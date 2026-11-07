// The ends a connection line can have, drawn the same way on the board and
// in every export. Besides the plain arrowhead and dot, the notations of
// common diagrams: UML (open triangle for generalization, diamonds for
// aggregation and composition), BPMN (filled triangle for sequence flow,
// open circle for message flow) and entity relationship diagrams (a bar for
// one, a crow's foot for many).
export const CAP_KINDS = [
  "none",
  "arrow",
  "triangle",
  "triangle-open",
  "diamond",
  "diamond-open",
  "circle",
  "circle-open",
  "bar",
  "crowfoot",
];
export const CAP_CHOICES = [
  ["none", "None"],
  ["arrow", "Arrowhead"],
  ["triangle", "Filled triangle"],
  ["triangle-open", "Open triangle"],
  ["diamond", "Filled diamond"],
  ["diamond-open", "Open diamond"],
  ["circle", "Dot"],
  ["circle-open", "Open circle"],
  ["bar", "Bar (one)"],
  ["crowfoot", "Crow's foot (many)"],
];
// The parts of the end `kind` at `point`, for a line that arrives there
// from `neighbor`. Each part is a polyline or a circle; `fill` is "line"
// for the line's color, "surface" for the white inside of an open shape,
// or null, and `stroke` whether its outline is drawn at the line's width.
export function capParts(kind, point, neighbor, thickness) {
  if (!kind || kind === "none") return [];
  const angle = Math.atan2(point.y - neighbor.y, point.x - neighbor.x),
    length = 9 + thickness * 1.2,
    ux = Math.cos(angle),
    uy = Math.sin(angle),
    // Across the line, at a right angle to it.
    px = -uy,
    py = ux,
    at = (back, side) => ({
      x: point.x - ux * back + px * side,
      y: point.y - uy * back + py * side,
    });
  const half = length * 0.5;
  switch (kind) {
    case "arrow":
      return [
        {
          type: "poly",
          points: [
            {
              x: point.x - length * Math.cos(angle - 0.5),
              y: point.y - length * Math.sin(angle - 0.5),
            },
            { x: point.x, y: point.y },
            {
              x: point.x - length * Math.cos(angle + 0.5),
              y: point.y - length * Math.sin(angle + 0.5),
            },
          ],
          closed: false,
          fill: null,
          stroke: true,
        },
      ];
    case "triangle":
    case "triangle-open":
      return [
        {
          type: "poly",
          points: [at(0, 0), at(length, half), at(length, -half)],
          closed: true,
          fill: kind === "triangle" ? "line" : "surface",
          stroke: true,
        },
      ];
    case "diamond":
    case "diamond-open":
      return [
        {
          type: "poly",
          points: [
            at(0, 0),
            at(length * 0.75, half * 0.85),
            at(length * 1.5, 0),
            at(length * 0.75, -half * 0.85),
          ],
          closed: true,
          fill: kind === "diamond" ? "line" : "surface",
          stroke: true,
        },
      ];
    case "circle":
      return [
        {
          type: "circle",
          x: point.x,
          y: point.y,
          r: thickness + 2,
          fill: "line",
          stroke: false,
        },
      ];
    case "circle-open": {
      const r = thickness + 3.5;
      return [
        {
          type: "circle",
          ...at(r, 0),
          r,
          fill: "surface",
          stroke: true,
        },
      ];
    }
    case "bar":
      return [
        {
          type: "poly",
          points: [at(length * 0.6, half), at(length * 0.6, -half)],
          closed: false,
          fill: null,
          stroke: true,
        },
      ];
    case "crowfoot": {
      const join = at(length, 0);
      return [half, 0, -half].map((side) => ({
        type: "poly",
        points: [join, at(0, side)],
        closed: false,
        fill: null,
        stroke: true,
      }));
    }
    default:
      return [];
  }
}
