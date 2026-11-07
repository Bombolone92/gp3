import { canRotateItem } from "./geometry.js";
import {
  SHAPE_SPECS,
  shapeOutline,
  polygonContains,
  outlineAnchor,
} from "./shape-specs.js";
// Shape geometry is shared by rendering, hit testing, connector attachment and
// the library previews. New silhouettes remain editable rectangle objects.
export const SHAPES = [
  { key: "rectangle", name: "Rectangle", hint: "Process" },
  { key: "ellipse", name: "Ellipse", hint: "Start or end" },
  { key: "diamond", name: "Diamond", hint: "Decision" },
  { key: "parallelogram", name: "Parallelogram", hint: "Input or output" },
  { key: "cylinder", name: "Cylinder", hint: "Database" },
  { key: "terminator", name: "Terminator", hint: "Start or end" },
  { key: "hexagon", name: "Hexagon", hint: "Preparation" },
  { key: "triangle", name: "Triangle", hint: "Basic shape" },
  { key: "star", name: "Star", hint: "Basic shape" },
  // Specialist families. Each key is a rectangle object with a silhouette.
  { key: "document", name: "Document", hint: "Flowchart" },
  { key: "multi-document", name: "Multiple documents", hint: "Flowchart" },
  { key: "predefined-process", name: "Predefined process", hint: "Flowchart" },
  { key: "manual-input", name: "Manual input", hint: "Flowchart" },
  { key: "manual-operation", name: "Manual operation", hint: "Flowchart" },
  { key: "delay", name: "Delay", hint: "Flowchart" },
  { key: "display", name: "Display", hint: "Flowchart" },
  { key: "off-page", name: "Off-page connector", hint: "Flowchart" },
  { key: "or", name: "Or", hint: "Flowchart" },
  { key: "summing-junction", name: "Summing junction", hint: "Flowchart" },
  { key: "internal-storage", name: "Internal storage", hint: "Flowchart" },
  { key: "merge", name: "Merge", hint: "Flowchart" },
  { key: "cloud", name: "Cloud", hint: "Architecture" },
  { key: "server", name: "Server", hint: "Architecture" },
  { key: "queue", name: "Queue", hint: "Architecture" },
  { key: "actor", name: "User or actor", hint: "Architecture" },
  { key: "mobile", name: "Mobile device", hint: "Architecture" },
  { key: "laptop", name: "Laptop", hint: "Architecture" },
  { key: "browser", name: "Browser window", hint: "Architecture" },
  { key: "firewall", name: "Firewall", hint: "Architecture" },
  { key: "load-balancer", name: "Load balancer", hint: "Architecture" },
  { key: "api", name: "API", hint: "Architecture" },
  { key: "container", name: "Container", hint: "Architecture" },
  { key: "data-store", name: "Data store", hint: "Data flow" },
  { key: "touchpoint", name: "Touchpoint", hint: "Service blueprint" },
  { key: "pain-point", name: "Pain point", hint: "Journey map" },
  { key: "emotion-high", name: "Positive emotion", hint: "Journey map" },
  { key: "emotion-neutral", name: "Neutral emotion", hint: "Journey map" },
  { key: "emotion-low", name: "Negative emotion", hint: "Journey map" },
  { key: "lane-header", name: "Lane header", hint: "Service blueprint" },
  { key: "start-event", name: "Start event", hint: "BPMN" },
  { key: "intermediate-event", name: "Intermediate event", hint: "BPMN" },
  { key: "end-event", name: "End event", hint: "BPMN" },
  { key: "bpmn-task", name: "Task", hint: "BPMN" },
  { key: "subprocess", name: "Subprocess", hint: "BPMN" },
  { key: "gateway-exclusive", name: "Exclusive gateway", hint: "BPMN" },
  { key: "gateway-parallel", name: "Parallel gateway", hint: "BPMN" },
  { key: "gateway-inclusive", name: "Inclusive gateway", hint: "BPMN" },
  { key: "data-object", name: "Data object", hint: "BPMN" },
  { key: "uml-class", name: "Class", hint: "UML" },
  { key: "uml-note", name: "Note", hint: "UML" },
  { key: "uml-package", name: "Package", hint: "UML" },
  { key: "wf-button", name: "Button", hint: "Wireframe" },
  { key: "wf-input", name: "Text input", hint: "Wireframe" },
  { key: "wf-checkbox", name: "Checkbox", hint: "Wireframe" },
  { key: "wf-radio", name: "Radio button", hint: "Wireframe" },
  {
    key: "wf-radio-selected",
    name: "Selected radio button",
    hint: "Wireframe",
  },
  { key: "wf-toggle", name: "Toggle", hint: "Wireframe" },
  { key: "wf-dropdown", name: "Dropdown", hint: "Wireframe" },
  { key: "wf-search", name: "Search bar", hint: "Wireframe" },
  { key: "wf-navbar", name: "Navigation bar", hint: "Wireframe" },
  { key: "wf-tabbar", name: "Tab bar", hint: "Wireframe" },
  { key: "wf-card", name: "Card", hint: "Wireframe" },
  { key: "wf-image", name: "Image placeholder", hint: "Wireframe" },
  { key: "wf-avatar", name: "Avatar", hint: "Wireframe" },
  { key: "wf-modal", name: "Modal dialog", hint: "Wireframe" },
  { key: "wf-phone", name: "Mobile phone frame", hint: "Wireframe" },
  { key: "wf-tablet", name: "Tablet frame", hint: "Wireframe" },
  { key: "wf-slider", name: "Slider", hint: "Wireframe" },
  { key: "wf-progress", name: "Progress bar", hint: "Wireframe" },
  { key: "wf-pagination", name: "Pagination", hint: "Wireframe" },
  { key: "wf-paragraph", name: "Text placeholder", hint: "Wireframe" },
];
export const CUSTOM_SHAPES = new Set(SHAPES.slice(2).map((s) => s.key));
// Library families. Entries may reuse a basic key under a domain name.
export const SHAPE_FAMILIES = [
  {
    id: "basic",
    name: "Basic shapes",
    shapes: SHAPES.slice(0, 9).map((s) => ({ key: s.key })),
  },
  {
    id: "flowchart",
    name: "Flowchart",
    shapes: [
      { key: "rectangle", name: "Process" },
      { key: "diamond", name: "Decision" },
      { key: "terminator", name: "Start or end" },
      { key: "parallelogram", name: "Data (input or output)" },
      { key: "document" },
      { key: "multi-document" },
      { key: "predefined-process" },
      { key: "manual-input" },
      { key: "manual-operation" },
      { key: "delay" },
      { key: "display" },
      { key: "off-page" },
      { key: "or" },
      { key: "summing-junction" },
      { key: "hexagon", name: "Preparation" },
      { key: "internal-storage" },
      { key: "merge" },
      { key: "triangle", name: "Extract" },
      { key: "cylinder", name: "Database" },
    ],
  },
  {
    id: "architecture",
    name: "Architecture and data flow",
    shapes: [
      "cloud",
      "server",
      "cylinder",
      "queue",
      "actor",
      "mobile",
      "laptop",
      "browser",
      "firewall",
      "load-balancer",
      "api",
      "container",
      "data-store",
    ].map((key) => ({
      key,
      ...(key === "cylinder" ? { name: "Database" } : {}),
    })),
  },
  {
    id: "journey",
    name: "Service blueprint and journey",
    shapes: [
      "touchpoint",
      "pain-point",
      "emotion-high",
      "emotion-neutral",
      "emotion-low",
      "lane-header",
      "actor",
    ].map((key) => ({ key })),
  },
  {
    id: "bpmn",
    name: "BPMN",
    shapes: [
      "start-event",
      "intermediate-event",
      "end-event",
      "bpmn-task",
      "subprocess",
      "gateway-exclusive",
      "gateway-parallel",
      "gateway-inclusive",
      "data-object",
    ].map((key) => ({ key })),
  },
  {
    id: "uml",
    name: "UML",
    shapes: [
      { key: "uml-class" },
      { key: "actor", name: "Actor" },
      { key: "uml-note" },
      { key: "uml-package" },
    ],
  },
  {
    id: "wireframe",
    name: "Wireframe",
    shapes: [
      ...SHAPES.filter((s) => s.key.startsWith("wf-")).slice(0, 14),
      { key: "browser" },
      ...SHAPES.filter((s) => s.key.startsWith("wf-")).slice(14),
    ].map((s) => ({ key: s.key })),
  },
];
// Insertion size and style for specialist shapes; basic shapes keep theirs.
export function shapeDefaults(key) {
  const { w, h, ...style } = SHAPE_SPECS[key]?.defaults || {};
  return w ? { w, h, ...style } : {};
}
const polygons = {
  diamond: [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ],
  triangle: [
    [0.5, 0],
    [1, 1],
    [0, 1],
  ],
  parallelogram: [
    [0.2, 0],
    [1, 0],
    [0.8, 1],
    [0, 1],
  ],
  hexagon: [
    [0.25, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0.25, 1],
    [0, 0.5],
  ],
  star: Array.from({ length: 10 }, (_, n) => {
    const angle = -Math.PI / 2 + (n * Math.PI) / 5,
      radius = n % 2 ? 0.22 : 0.5;
    return [0.5 + radius * Math.cos(angle), 0.5 + radius * Math.sin(angle)];
  }),
};
export const shapeKey = (i) =>
  i.type === "ellipse"
    ? "ellipse"
    : i.type === "rect"
      ? i.shape || "rectangle"
      : i.type;
export const canSwitchShape = (i) =>
  ["rect", "ellipse", "note", "text"].includes(i.type);
export function switchShape(i, key) {
  if (!["note", "text", ...SHAPES.map((s) => s.key)].includes(key))
    throw Error("Invalid shape.");
  if (shapeKey(i) === key) return;
  const size = i.type === "text" ? 28 : 19;
  const align = i.type === "rect" && i.shape ? "center" : "left";
  if (i.fontSize == null && size !== (key === "text" ? 28 : 19))
    i.fontSize = size;
  if (
    i.textAlign == null &&
    align !== (CUSTOM_SHAPES.has(key) ? "center" : "left")
  )
    i.textAlign = align;
  i.type = key === "ellipse" || key === "note" || key === "text" ? key : "rect";
  if (!canRotateItem(i)) delete i.rotation;
  if (i.type === "text") {
    // Text starts at its top and grows; only notes and shapes align it.
    delete i.autoFontSize;
    delete i.textValign;
    i.autoHeight = true;
  } else delete i.autoHeight;
  if (CUSTOM_SHAPES.has(key)) i.shape = key;
  else delete i.shape;
}

export function shapePath(ctx, key, w, h) {
  ctx.beginPath();
  if (SHAPE_SPECS[key]) {
    for (const points of shapeOutline(key, w, h)) {
      points.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    }
  } else if (polygons[key]) {
    polygons[key].forEach(([x, y], n) =>
      n ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h),
    );
    ctx.closePath();
  } else if (key === "cylinder") {
    const ry = h * 0.12;
    ctx.ellipse(w / 2, ry, w / 2, ry, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(w, h - ry);
    ctx.ellipse(w / 2, h - ry, w / 2, ry, 0, 0, Math.PI);
    ctx.closePath();
  } else if (key === "ellipse")
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else
    ctx.roundRect(0, 0, w, h, key === "terminator" ? Math.min(w, h) / 2 : 10);
}
export function shapeDetail(ctx, key, w, h) {
  if (key !== "cylinder") return;
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.12, w / 2, h * 0.12, 0, 0, Math.PI);
  ctx.stroke();
}

export function shapeContains(i, x, y) {
  if (x < 0 || y < 0 || x > i.w || y > i.h) return false;
  if (SHAPE_SPECS[i.shape])
    return shapeOutline(i.shape, i.w, i.h).some((points) =>
      polygonContains(points, x, y),
    );
  if (i.shape === "cylinder") {
    const ry = i.h * 0.12;
    return (
      (y >= ry && y <= i.h - ry) ||
      ((x - i.w / 2) / (i.w / 2)) ** 2 +
        ((y - (y < ry ? ry : i.h - ry)) / ry) ** 2 <=
        1 + 1e-12
    );
  }
  if (i.shape === "terminator") {
    const r = Math.min(i.w, i.h) / 2;
    const cx = Math.max(r, Math.min(i.w - r, x)),
      cy = Math.max(r, Math.min(i.h - r, y));
    return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2 + 1e-9;
  }
  const points = polygons[i.shape];
  if (!points) return true;
  x /= i.w;
  y /= i.h;
  let inside = false;
  for (let n = 0, p = points.length - 1; n < points.length; p = n++) {
    const [ax, ay] = points[p],
      [bx, by] = points[n];
    const area = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (
      Math.abs(area) < 1e-12 &&
      x >= Math.min(ax, bx) &&
      x <= Math.max(ax, bx) &&
      y >= Math.min(ay, by) &&
      y <= Math.max(ay, by)
    )
      return true;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  return inside;
}

export function shapeAnchor(i, toward) {
  const cx = i.x + i.w / 2,
    cy = i.y + i.h / 2,
    dx = toward.x - cx,
    dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  if (SHAPE_SPECS[i.shape]) {
    const t = outlineAnchor(
      shapeOutline(i.shape, i.w, i.h),
      i.w / 2,
      i.h / 2,
      dx,
      dy,
    );
    return { x: cx + dx * t, y: cy + dy * t };
  }
  const points = polygons[i.shape];
  if (points) {
    const vx = dx / i.w,
      vy = dy / i.h;
    let distance = Infinity;
    for (let n = 0; n < points.length; n++) {
      const [ax, ay] = points[n],
        [bx, by] = points[(n + 1) % points.length];
      const sx = bx - ax,
        sy = by - ay,
        denominator = vx * sy - vy * sx;
      if (denominator === 0) continue;
      const t = ((ax - 0.5) * sy - (ay - 0.5) * sx) / denominator;
      const u = ((ax - 0.5) * vy - (ay - 0.5) * vx) / denominator;
      if (t >= 0 && u >= -1e-12 && u <= 1 + 1e-12)
        distance = Math.min(distance, t);
    }
    return { x: cx + dx * distance, y: cy + dy * distance };
  }
  // Curved silhouettes are convex. Bisect the center-to-box-edge ray using
  // exact containment, avoiding a polygon approximation at large zooms.
  let low = 0,
    high = 1 / Math.max(Math.abs(dx) / (i.w / 2), Math.abs(dy) / (i.h / 2));
  for (let n = 0; n < 40; n++) {
    const middle = (low + high) / 2;
    if (shapeContains(i, i.w / 2 + dx * middle, i.h / 2 + dy * middle))
      low = middle;
    else high = middle;
  }
  return { x: cx + dx * low, y: cy + dy * low };
}

export function shapeTextBox(i) {
  let box = [0, 0, 1, 1];
  if (i.type === "rect" && SHAPE_SPECS[i.shape]) {
    const [x, y, w, h] = SHAPE_SPECS[i.shape].text(i.w, i.h);
    // Fixed insets can exceed a very small shape; the box never inverts.
    return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
  }
  if (i.type === "rect") {
    if (i.shape === "diamond") box = [0.25, 0.25, 0.5, 0.5];
    else if (i.shape === "triangle") box = [0.25, 0.5, 0.5, 0.5];
    else if (i.shape === "star") box = [0.36, 0.37, 0.28, 0.27];
    else if (i.shape === "parallelogram") box = [0.2, 0, 0.6, 1];
    else if (i.shape === "hexagon") box = [0.25, 0, 0.5, 1];
    else if (i.shape === "cylinder") box = [0, 0.24, 1, 0.64];
    else if (i.shape === "terminator") {
      const r = Math.min(i.w, i.h) / 2;
      return { x: r * 0.3, y: r * 0.3, w: i.w - r * 0.6, h: i.h - r * 0.6 };
    }
  }
  return { x: box[0] * i.w, y: box[1] * i.h, w: box[2] * i.w, h: box[3] * i.h };
}

export function shapeIcon(key) {
  const polygon = polygons[key];
  const body = polygon
    ? `<polygon points="${polygon.map(([x, y]) => `${x * 100},${y * 80}`).join(" ")}"/>`
    : key === "ellipse"
      ? '<ellipse cx="50" cy="40" rx="50" ry="40"/>'
      : key === "cylinder"
        ? '<path d="M0 10 A50 10 0 0 1 100 10 V70 A50 10 0 0 1 0 70 Z M0 10 A50 10 0 0 0 100 10"/>'
        : key === "text"
          ? '<path d="M20 10 H80 M50 10 V70 M35 70 H65"/>'
          : `<rect width="100" height="80" rx="${key === "terminator" ? 40 : key === "note" ? 2 : 10}"/>`;
  return `<svg viewBox="-3 -3 106 86" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round">${body}</svg>`;
}
