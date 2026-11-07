// Specialist shape families. Each silhouette is a list of polygons in object
// pixels, so rendering, hit testing and connector attachment share one
// outline. Curves are sampled finely enough to look smooth at any zoom that
// fits on screen. Details are drawn clipped to the silhouette and never
// affect hit testing. This module has no browser or icon dependencies; the
// renderer passes a glyph drawer to the detail functions.
const INK = "#30342f",
  // Meaningful contours stay above 3:1 on the standard pale fills and both
  // canvas backgrounds, including blank notation keys in template legends.
  LINE = "#687169",
  TONE = "#d5dbd0",
  DARK = "#4a5a73",
  BEZEL = "#3d4450";
export const SHAPE_COLORS = { INK, LINE, TONE, DARK, BEZEL };
const TAU = Math.PI * 2;
// Corner radius that keeps small objects legible and the corners open.
const R = (w, h) => Math.min(8, w / 4, h / 4);
// Magnifier size and spacing for the search bar shape.
function searchParts(w, h) {
  if (w < h * 1.5) return { g: Math.min(w, h) * 0.3, x: 0, gap: 0, right: 0 };
  return {
    g: Math.min(h * 0.5, w * 0.18),
    x: Math.min(h * 0.35, w * 0.08),
    gap: Math.min(h * 0.2, w * 0.04),
    right: Math.min(h * 0.4, w * 0.08),
  };
}
// Each [x, y, r] corner with r > 0 becomes a sampled quadratic curve, with
// more samples for larger corners so pill ends and big radii stay smooth.
function rounded(points, minSteps = 5) {
  const out = [],
    n = points.length;
  for (let k = 0; k < n; k++) {
    const [x, y, r = 0] = points[k];
    if (!r) {
      out.push([x, y]);
      continue;
    }
    const [px, py] = points[(k + n - 1) % n],
      [nx, ny] = points[(k + 1) % n];
    const lp = Math.hypot(px - x, py - y),
      ln = Math.hypot(nx - x, ny - y);
    if (!lp || !ln) {
      out.push([x, y]);
      continue;
    }
    const d1 = Math.min(r, lp / 2),
      d2 = Math.min(r, ln / 2);
    const ax = x + ((px - x) * d1) / lp,
      ay = y + ((py - y) * d1) / lp,
      bx = x + ((nx - x) * d2) / ln,
      by = y + ((ny - y) * d2) / ln;
    const steps = Math.max(
      minSteps,
      Math.min(32, Math.ceil(Math.sqrt(Math.max(d1, d2)) * 3)),
    );
    for (let s = 0; s <= steps; s++) {
      const t = s / steps,
        u = 1 - t;
      out.push([
        u * u * ax + 2 * u * t * x + t * t * bx,
        u * u * ay + 2 * u * t * y + t * t * by,
      ]);
    }
  }
  return out;
}
const rect = (x, y, w, h, r) =>
  rounded([
    [x, y, r],
    [x + w, y, r],
    [x + w, y + h, r],
    [x, y + h, r],
  ]);
function arcPoints(cx, cy, rx, ry, from, to, steps) {
  const out = [];
  for (let s = 0; s <= steps; s++) {
    const a = from + ((to - from) * s) / steps;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}
const oval = (cx, cy, rx, ry, steps = 96) =>
  arcPoints(cx, cy, rx, ry, 0, TAU, steps).slice(0, -1);
const inset = ([x, y, w, h], d) => [x + d, y + d, w - d * 2, h - d * 2];
// Normalized cloud outline: quadratic bumps around a flattened ellipse,
// sampled once and stretched to the object's box.
const cloud = (() => {
  const base = [
    [0.1, 0.62],
    [0.2, 0.32],
    [0.44, 0.16],
    [0.7, 0.2],
    [0.88, 0.42],
    [0.86, 0.74],
    [0.62, 0.86],
    [0.34, 0.86],
  ];
  const points = [];
  base.forEach(([ax, ay], n) => {
    const [bx, by] = base[(n + 1) % base.length];
    const mx = (ax + bx) / 2,
      my = (ay + by) / 2,
      cx = 0.5 + (mx - 0.5) * 1.55,
      cy = 0.54 + (my - 0.54) * 1.55;
    for (let s = 0; s < 12; s++) {
      const t = s / 12,
        u = 1 - t;
      points.push([
        u * u * ax + 2 * u * t * cx + t * t * bx,
        u * u * ay + 2 * u * t * cy + t * t * by,
      ]);
    }
  });
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs),
    y0 = Math.min(...ys),
    sx = Math.max(...xs) - x0,
    sy = Math.max(...ys) - y0;
  return points.map(([x, y]) => [(x - x0) / sx, (y - y0) / sy]);
})();
const burst = Array.from({ length: 18 }, (_, n) => {
  const a = -Math.PI / 2 + (n * Math.PI) / 9,
    r = n % 2 ? 0.4 : 0.5;
  return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)];
});
const scaled = (points, w, h) => points.map(([x, y]) => [x * w, y * h]);
function documentOutline(x0, y0, w, h) {
  const r = R(w, h),
    points = [
      [x0, y0, r],
      [x0 + w, y0, r],
    ];
  for (let s = 0; s <= 32; s++) {
    const x = w - (w * s) / 32;
    points.push([x0 + x, y0 + h * 0.88 + h * 0.1 * Math.sin((TAU * x) / w)]);
  }
  return rounded(points);
}
const documentText = (x0, y0, w, h) =>
  inset([x0, y0, w, h * 0.76], R(w, h) * 0.35);
const circle = (w, h) => [oval(w / 2, h / 2, w / 2, h / 2)];
const box = (w, h) => [rect(0, 0, w, h, R(w, h))];
const full = (w, h) => inset([0, 0, w, h], R(w, h) * 0.35);
// Form fields keep their label clear of the left edge.
const field = (w, h, right) => {
  const x = Math.min(10, w * 0.06);
  return [x, R(w, h) * 0.35, right - x - R(w, h) * 0.35, h - R(w, h) * 0.7];
};
const centered = (w, h, f = 0.25) => [
  w * f,
  h * f,
  w * (1 - f * 2),
  h * (1 - f * 2),
];
// Icon area of the card-style architecture nodes.
export function glyphBox(w, h) {
  const size = Math.min(h * 0.56, w * 0.3),
    x = Math.min(h * 0.2, w * 0.06);
  return { x, y: (h - size) / 2, size };
}
const glyphCard = (glyph) => ({
  outline: box,
  text(w, h) {
    const g = glyphBox(w, h),
      left = g.x * 2 + g.size;
    return inset([left, 0, w - left, h], R(w, h) * 0.35);
  },
  detail(ctx, w, h, tools) {
    const g = glyphBox(w, h);
    tools.glyph(glyph, g.x, g.y, g.size);
  },
  defaults: { w: 220, h: 90, color: "#ffffff", textAlign: "left" },
});
// Leading control area (checkbox, radio, toggle) and the label after it.
function control(w, h, ratio = 1) {
  const s = Math.min(h * 0.6, (w * 0.22) / ratio),
    x = Math.min((h - s) / 2, w * 0.05);
  return { x, y: (h - s) / 2, s, end: x * 2 + s * ratio };
}
const labelAfter = (ratio) => (w, h) => {
  const c = control(w, h, ratio);
  return inset([c.end, 0, w - c.end, h], R(w, h) * 0.35);
};
function strokeLine(ctx, points, width = 1.5, color = INK) {
  ctx.beginPath();
  points.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}
function fillOval(ctx, cx, cy, rx, ry, color) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}
function strokeOval(ctx, cx, cy, rx, ry, width, color = INK) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, 0, TAU);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}
function roundBox(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(
    x,
    y,
    Math.max(0, w),
    Math.max(0, h),
    Math.max(0, Math.min(r, w / 2, h / 2)),
  );
}
// A ring just inside a circular silhouette.
function border(ctx, w, h, width) {
  strokeOval(ctx, w / 2, h / 2, w / 2 - width / 2, h / 2 - width / 2, width);
}
function face(ctx, w, h, mood) {
  const m = Math.min(w, h),
    lw = Math.max(1.2, m * 0.035);
  fillOval(ctx, w * 0.37, h * 0.36, m * 0.045, m * 0.045, INK);
  fillOval(ctx, w * 0.63, h * 0.36, m * 0.045, m * 0.045, INK);
  const y = h * 0.5,
    bend = mood * h * 0.07;
  ctx.beginPath();
  ctx.moveTo(w * 0.34, y);
  ctx.quadraticCurveTo(w * 0.5, y + bend * 2, w * 0.66, y);
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
}
function deviceScreen(w, h, key) {
  const [sx, sy, sb] =
    key === "wf-tablet" ? [0.06, 0.08, 0.08] : [0.045, 0.078, 0.067];
  return [w * sx, h * sy, w * (1 - sx * 2), h * (1 - sy - sb)];
}
const device = (key) => ({
  outline: (w, h) => [
    rect(
      0,
      0,
      w,
      h,
      key === "wf-tablet"
        ? Math.min(w * 0.06, h * 0.08)
        : Math.min(w * 0.12, h * 0.07),
    ),
  ],
  text: (w, h) => inset(deviceScreen(w, h, key), 2),
  detail(ctx, w, h, tools) {
    const [x, y, sw, sh] = deviceScreen(w, h, key);
    tools.trace();
    ctx.rect(x + sw, y, -sw, sh);
    ctx.fillStyle = BEZEL;
    ctx.fill("evenodd");
    if (key === "wf-tablet")
      fillOval(
        ctx,
        w / 2,
        y / 2,
        Math.min(w, h) * 0.012,
        Math.min(w, h) * 0.012,
        "#6b737d",
      );
    else {
      roundBox(ctx, w * 0.38, y * 0.32, w * 0.24, y * 0.34, y * 0.17);
      ctx.fillStyle = "#1f2328";
      ctx.fill();
      roundBox(
        ctx,
        w * 0.35,
        h - (h - y - sh) * 0.55,
        w * 0.3,
        Math.max(1, (h - y - sh) * 0.1),
        3,
      );
      ctx.fillStyle = "#8a929c";
      ctx.fill();
    }
  },
  defaults:
    key === "wf-tablet"
      ? { w: 720, h: 520, color: "#ffffff" }
      : { w: 360, h: 720, color: "#ffffff" },
});
const WF = { color: "#ffffff", fontSize: 16 };
// A radio button's ring, returning the control's box.
function radio(ctx, w, h) {
  const c = control(w, h),
    r = c.s / 2;
  strokeOval(
    ctx,
    c.x + r,
    c.y + r,
    r * 0.92,
    r * 0.92,
    Math.max(1, c.s * 0.08),
  );
  return c;
}
export const SHAPE_SPECS = {
  // Flowchart
  document: {
    outline: (w, h) => [documentOutline(0, 0, w, h)],
    text: (w, h) => documentText(0, 0, w, h),
    defaults: { w: 220, h: 130 },
  },
  "multi-document": {
    outline(w, h) {
      const d = Math.min(w, h) * 0.06;
      return [
        documentOutline(d * 2, 0, w - d * 2, h - d * 2),
        documentOutline(d, d, w - d * 2, h - d * 2),
        documentOutline(0, d * 2, w - d * 2, h - d * 2),
      ];
    },
    text(w, h) {
      const d = Math.min(w, h) * 0.06;
      return documentText(0, d * 2, w - d * 2, h - d * 2);
    },
    defaults: { w: 220, h: 140 },
  },
  "predefined-process": {
    outline: box,
    text(w, h) {
      const e = Math.min(w * 0.1, h * 0.35);
      return inset([e, 0, w - e * 2, h], R(w, h) * 0.35);
    },
    detail(ctx, w, h) {
      const e = Math.min(w * 0.1, h * 0.35);
      strokeLine(
        ctx,
        [
          [e, 0],
          [e, h],
        ],
        1,
        LINE,
      );
      strokeLine(
        ctx,
        [
          [w - e, 0],
          [w - e, h],
        ],
        1,
        LINE,
      );
    },
    defaults: { w: 220, h: 110 },
  },
  "manual-input": {
    outline(w, h) {
      const r = R(w, h);
      return [
        rounded([
          [0, h * 0.3, r],
          [w, 0, r],
          [w, h, r],
          [0, h, r],
        ]),
      ];
    },
    text: (w, h) => inset([0, h * 0.3, w, h * 0.7], R(w, h) * 0.5),
    defaults: { w: 220, h: 120 },
  },
  "manual-operation": {
    outline(w, h) {
      const r = R(w, h);
      return [
        rounded([
          [0, 0, r],
          [w, 0, r],
          [w * 0.8, h, r],
          [w * 0.2, h, r],
        ]),
      ];
    },
    text: (w, h) => inset([w * 0.2, 0, w * 0.6, h], R(w, h) * 0.5),
    defaults: { w: 220, h: 110 },
  },
  delay: {
    outline(w, h) {
      const r = R(w, h),
        rx = Math.min(w / 2, h / 2);
      return [
        rounded([
          [0, 0, r],
          ...arcPoints(w - rx, h / 2, rx, h / 2, -Math.PI / 2, Math.PI / 2, 40),
          [0, h, r],
        ]),
      ];
    },
    text(w, h) {
      const rx = Math.min(w / 2, h / 2);
      return inset([0, h * 0.15, w - rx * 0.4, h * 0.7], R(w, h) * 0.35);
    },
    defaults: { w: 200, h: 110 },
  },
  display: {
    outline(w, h) {
      const rx = Math.min(w * 0.18, h / 2);
      return [
        [
          [0, h / 2],
          [w * 0.18, 0],
          ...arcPoints(w - rx, h / 2, rx, h / 2, -Math.PI / 2, Math.PI / 2, 40),
          [w * 0.18, h],
        ],
      ];
    },
    text(w, h) {
      const rx = Math.min(w * 0.18, h / 2);
      return [w * 0.18, h * 0.1, w * 0.82 - rx, h * 0.8];
    },
    defaults: { w: 220, h: 110 },
  },
  "off-page": {
    outline(w, h) {
      const r = R(w, h);
      return [
        rounded([
          [0, 0, r],
          [w, 0, r],
          [w, h * 0.62, r / 2],
          [w / 2, h, r / 2],
          [0, h * 0.62, r / 2],
        ]),
      ];
    },
    text: (w, h) => inset([0, 0, w, h * 0.62], R(w, h) * 0.5),
    defaults: { w: 110, h: 110 },
  },
  or: {
    outline: circle,
    text: (w, h) => centered(w, h),
    detail(ctx, w, h) {
      const lw = Math.max(1, Math.min(w, h) * 0.02);
      strokeLine(
        ctx,
        [
          [w / 2, 0],
          [w / 2, h],
        ],
        lw,
        LINE,
      );
      strokeLine(
        ctx,
        [
          [0, h / 2],
          [w, h / 2],
        ],
        lw,
        LINE,
      );
    },
    defaults: { w: 80, h: 80 },
  },
  "summing-junction": {
    outline: circle,
    text: (w, h) => centered(w, h),
    detail(ctx, w, h) {
      const lw = Math.max(1, Math.min(w, h) * 0.02),
        c = Math.SQRT1_2 / 2;
      strokeLine(
        ctx,
        [
          [w * (0.5 - c), h * (0.5 - c)],
          [w * (0.5 + c), h * (0.5 + c)],
        ],
        lw,
        LINE,
      );
      strokeLine(
        ctx,
        [
          [w * (0.5 + c), h * (0.5 - c)],
          [w * (0.5 - c), h * (0.5 + c)],
        ],
        lw,
        LINE,
      );
    },
    defaults: { w: 80, h: 80 },
  },
  "internal-storage": {
    outline: box,
    text(w, h) {
      const e = Math.min(w * 0.14, h * 0.3),
        f = Math.min(h * 0.2, w * 0.3);
      return inset([e, f, w - e, h - f], R(w, h) * 0.35);
    },
    detail(ctx, w, h) {
      const e = Math.min(w * 0.14, h * 0.3),
        f = Math.min(h * 0.2, w * 0.3);
      strokeLine(
        ctx,
        [
          [e, 0],
          [e, h],
        ],
        1,
        LINE,
      );
      strokeLine(
        ctx,
        [
          [0, f],
          [w, f],
        ],
        1,
        LINE,
      );
    },
    defaults: { w: 200, h: 130 },
  },
  merge: {
    outline(w, h) {
      const r = R(w, h);
      return [
        rounded([
          [0, 0, r],
          [w, 0, r],
          [w / 2, h, r / 2],
        ]),
      ];
    },
    text: (w, h) => inset([w * 0.25, 0, w * 0.5, h * 0.45], R(w, h) * 0.35),
    defaults: { w: 140, h: 120 },
  },
  // Architecture and data flow
  cloud: {
    outline: (w, h) => [scaled(cloud, w, h)],
    text: (w, h) => [w * 0.24, h * 0.32, w * 0.52, h * 0.44],
    defaults: { w: 240, h: 150, color: "#ffffff" },
  },
  server: glyphCard("server"),
  firewall: glyphCard("brick-wall"),
  "load-balancer": glyphCard("network"),
  api: glyphCard("braces"),
  container: glyphCard("container"),
  queue: {
    outline(w, h) {
      const rx = Math.min(w * 0.15, h * 0.25);
      return [
        [
          ...arcPoints(w - rx, h / 2, rx, h / 2, -Math.PI / 2, Math.PI / 2, 32),
          ...arcPoints(rx, h / 2, rx, h / 2, Math.PI / 2, Math.PI * 1.5, 32),
        ],
      ];
    },
    text(w, h) {
      const rx = Math.min(w * 0.15, h * 0.25);
      return [rx * 1.1, h * 0.12, w - rx * 3.1, h * 0.76];
    },
    detail(ctx, w, h) {
      const rx = Math.min(w * 0.15, h * 0.25);
      ctx.beginPath();
      ctx.ellipse(w - rx, h / 2, rx, h / 2, 0, Math.PI / 2, Math.PI * 1.5);
      ctx.lineWidth = 1;
      ctx.strokeStyle = LINE;
      ctx.stroke();
    },
    defaults: { w: 240, h: 90, color: "#ffffff" },
  },
  actor: {
    outline(w, h) {
      const shoulders = Math.min(w * 0.3, h * 0.28),
        r = R(w, h);
      return [
        oval(w / 2, h * 0.2, w * 0.18, h * 0.18, 64),
        rounded([
          [w * 0.08, h * 0.44, shoulders],
          [w * 0.92, h * 0.44, shoulders],
          [w * 0.92, h, r],
          [w * 0.08, h, r],
        ]),
      ];
    },
    text: (w, h) => [w * 0.2, h * 0.58, w * 0.6, h * 0.36],
    defaults: { w: 130, h: 150, color: "#dce5f7" },
  },
  mobile: {
    outline: (w, h) => [rect(0, 0, w, h, Math.min(w * 0.16, h * 0.1))],
    text: (w, h) => inset([w * 0.1, h * 0.12, w * 0.8, h * 0.72], 1),
    detail(ctx, w, h) {
      roundBox(ctx, w * 0.1, h * 0.12, w * 0.8, h * 0.72, 3);
      ctx.lineWidth = 1;
      ctx.strokeStyle = LINE;
      ctx.stroke();
      strokeLine(
        ctx,
        [
          [w * 0.4, h * 0.06],
          [w * 0.6, h * 0.06],
        ],
        Math.max(1, h * 0.012),
        LINE,
      );
      strokeOval(
        ctx,
        w / 2,
        h * 0.92,
        Math.min(w, h) * 0.05,
        Math.min(w, h) * 0.05,
        1,
        LINE,
      );
    },
    defaults: { w: 110, h: 180, color: "#ffffff" },
  },
  laptop: {
    outline(w, h) {
      const r = R(w, h);
      return [
        rect(w * 0.1, 0, w * 0.8, h * 0.8, r),
        rounded([
          [w * 0.02, h * 0.8, r / 2],
          [w * 0.98, h * 0.8, r / 2],
          [w, h, r / 2],
          [0, h, r / 2],
        ]),
      ];
    },
    text: (w, h) => inset([w * 0.15, h * 0.08, w * 0.7, h * 0.64], 1),
    detail(ctx, w, h) {
      roundBox(ctx, w * 0.15, h * 0.08, w * 0.7, h * 0.64, 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = LINE;
      ctx.stroke();
    },
    defaults: { w: 220, h: 150, color: "#ffffff" },
  },
  browser: {
    outline: box,
    text(w, h) {
      const bar = Math.min(44, h * 0.18);
      return inset([0, bar, w, h - bar], R(w, h) * 0.35 + 2);
    },
    detail(ctx, w, h) {
      const bar = Math.min(44, h * 0.18),
        dot = Math.min(bar * 0.12, w * 0.02);
      ctx.fillStyle = "#eef1eb";
      ctx.fillRect(0, 0, w, bar);
      strokeLine(
        ctx,
        [
          [0, bar],
          [w, bar],
        ],
        1,
        LINE,
      );
      for (let n = 0; n < 3; n++)
        fillOval(
          ctx,
          bar * 0.45 + n * dot * 3.2,
          bar / 2,
          dot,
          dot,
          n ? TONE : "#c7a8a2",
        );
      const left = bar * 0.45 + dot * 10;
      roundBox(
        ctx,
        left,
        bar * 0.24,
        Math.max(0, w - left - bar * 0.45),
        bar * 0.52,
        bar * 0.26,
      );
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = TONE;
      ctx.stroke();
    },
    defaults: { w: 960, h: 640, color: "#ffffff" },
  },
  "data-store": {
    bare: true,
    outline: box,
    text(w, h) {
      const d = Math.min(w * 0.2, h * 0.6);
      return inset([d, 0, w - d, h], R(w, h) * 0.35);
    },
    detail(ctx, w, h) {
      const d = Math.min(w * 0.2, h * 0.6),
        lw = 1.5;
      strokeLine(
        ctx,
        [
          [w, lw / 2],
          [lw / 2, lw / 2],
          [lw / 2, h - lw / 2],
          [w, h - lw / 2],
        ],
        lw,
      );
      strokeLine(
        ctx,
        [
          [d, 0],
          [d, h],
        ],
        lw,
      );
    },
    defaults: { w: 220, h: 70, color: "#ffffff" },
  },
  // Service blueprint and journey mapping
  touchpoint: {
    outline: circle,
    text: (w, h) => centered(w, h, 0.22),
    detail(ctx, w, h) {
      strokeOval(
        ctx,
        w / 2,
        h / 2,
        w * 0.42,
        h * 0.42,
        Math.max(1, Math.min(w, h) * 0.015),
        LINE,
      );
    },
    defaults: { w: 120, h: 120, color: "#dce5f7" },
  },
  "pain-point": {
    outline: (w, h) => [scaled(burst, w, h)],
    text: (w, h) => [w * 0.27, h * 0.3, w * 0.46, h * 0.4],
    defaults: { w: 150, h: 130, color: "#f4c7c3" },
  },
  "emotion-high": {
    outline: circle,
    text: (w, h) => [w * 0.28, h * 0.64, w * 0.44, h * 0.2],
    detail: (ctx, w, h) => face(ctx, w, h, 1),
    defaults: { w: 80, h: 80, color: "#d9e9d2" },
  },
  "emotion-neutral": {
    outline: circle,
    text: (w, h) => [w * 0.28, h * 0.64, w * 0.44, h * 0.2],
    detail: (ctx, w, h) => face(ctx, w, h, 0),
    defaults: { w: 80, h: 80, color: "#f6e7a4" },
  },
  "emotion-low": {
    outline: circle,
    text: (w, h) => [w * 0.28, h * 0.64, w * 0.44, h * 0.2],
    detail: (ctx, w, h) => face(ctx, w, h, -1),
    defaults: { w: 80, h: 80, color: "#f3d6c8" },
  },
  "lane-header": {
    outline: box,
    text(w, h) {
      const b = Math.min(w * 0.06, h * 0.3, 12);
      return inset([b, 0, w - b, h], R(w, h) * 0.35 + 2);
    },
    detail(ctx, w, h) {
      ctx.fillStyle = DARK;
      ctx.fillRect(0, 0, Math.min(w * 0.06, h * 0.3, 12), h);
    },
    defaults: {
      w: 180,
      h: 120,
      color: "#e6ebdf",
      textAlign: "left",
      bold: true,
    },
  },
  // BPMN
  "start-event": {
    outline: circle,
    text: (w, h) => centered(w, h),
    detail: (ctx, w, h) =>
      border(ctx, w, h, Math.max(1.2, Math.min(w, h) * 0.03)),
    defaults: { w: 60, h: 60, color: "#d9e9d2" },
  },
  "intermediate-event": {
    outline: circle,
    text: (w, h) => centered(w, h),
    detail(ctx, w, h) {
      const lw = Math.max(1, Math.min(w, h) * 0.025);
      border(ctx, w, h, lw);
      strokeOval(ctx, w / 2, h / 2, w * 0.41, h * 0.41, lw);
    },
    defaults: { w: 60, h: 60, color: "#f6e7a4" },
  },
  "end-event": {
    outline: circle,
    text: (w, h) => centered(w, h, 0.28),
    detail: (ctx, w, h) =>
      border(ctx, w, h, Math.max(2, Math.min(w, h) * 0.09)),
    defaults: { w: 60, h: 60, color: "#f3d6c8" },
  },
  "bpmn-task": {
    outline: (w, h) => [rect(0, 0, w, h, Math.min(14, w / 4, h / 4))],
    text: (w, h) => inset([0, 0, w, h], Math.min(14, w / 4, h / 4) * 0.35),
    defaults: { w: 160, h: 90, color: "#ffffff" },
  },
  subprocess: {
    outline: (w, h) => [rect(0, 0, w, h, Math.min(14, w / 4, h / 4))],
    text(w, h) {
      const s = Math.min(h * 0.18, w * 0.12);
      return inset(
        [0, 0, w, h - s - h * 0.08],
        Math.min(14, w / 4, h / 4) * 0.35,
      );
    },
    detail(ctx, w, h) {
      const s = Math.min(h * 0.18, w * 0.12),
        x = w / 2 - s / 2,
        y = h - s - h * 0.06;
      ctx.beginPath();
      ctx.rect(x, y, s, s);
      ctx.lineWidth = 1;
      ctx.strokeStyle = INK;
      ctx.stroke();
      strokeLine(
        ctx,
        [
          [x + s * 0.25, y + s / 2],
          [x + s * 0.75, y + s / 2],
        ],
        1,
      );
      strokeLine(
        ctx,
        [
          [x + s / 2, y + s * 0.25],
          [x + s / 2, y + s * 0.75],
        ],
        1,
      );
    },
    defaults: { w: 170, h: 100, color: "#ffffff" },
  },
  "gateway-exclusive": gateway((ctx, w, h, lw) => {
    strokeLine(
      ctx,
      [
        [w * 0.4, h * 0.28],
        [w * 0.6, h * 0.48],
      ],
      lw,
    );
    strokeLine(
      ctx,
      [
        [w * 0.6, h * 0.28],
        [w * 0.4, h * 0.48],
      ],
      lw,
    );
  }),
  "gateway-parallel": gateway((ctx, w, h, lw) => {
    strokeLine(
      ctx,
      [
        [w / 2, h * 0.25],
        [w / 2, h * 0.51],
      ],
      lw,
    );
    strokeLine(
      ctx,
      [
        [w * 0.37, h * 0.38],
        [w * 0.63, h * 0.38],
      ],
      lw,
    );
  }),
  "gateway-inclusive": gateway((ctx, w, h, lw) =>
    strokeOval(ctx, w / 2, h * 0.38, w * 0.12, h * 0.12, lw),
  ),
  "data-object": page({ w: 90, h: 120, color: "#ffffff" }),
  // UML
  "uml-class": {
    outline: box,
    text: (w, h) => inset([0, 0, w, h * 0.3], R(w, h) * 0.35),
    detail(ctx, w, h) {
      strokeLine(
        ctx,
        [
          [0, h * 0.3],
          [w, h * 0.3],
        ],
        1,
        LINE,
      );
      strokeLine(
        ctx,
        [
          [0, h * 0.65],
          [w, h * 0.65],
        ],
        1,
        LINE,
      );
    },
    defaults: { w: 220, h: 180, color: "#ffffff", bold: true },
  },
  "uml-note": page({ w: 200, h: 130, color: "#f6e7a4", textAlign: "left" }),
  "uml-package": {
    outline(w, h) {
      const r = R(w, h),
        t = Math.min(h * 0.2, w * 0.25);
      return [
        rounded([
          [0, 0, r],
          [w * 0.4, 0, r / 2],
          [w * 0.4 + t * 0.4, t],
          [w, t, r],
          [w, h, r],
          [0, h, r],
        ]),
      ];
    },
    text(w, h) {
      const t = Math.min(h * 0.2, w * 0.25);
      return inset([0, t, w, h - t], R(w, h) * 0.35);
    },
    detail(ctx, w, h) {
      const t = Math.min(h * 0.2, w * 0.25);
      strokeLine(
        ctx,
        [
          [0, t],
          [w * 0.4 + t * 0.4, t],
        ],
        1,
        LINE,
      );
    },
    defaults: { w: 220, h: 150, color: "#ffffff" },
  },
  // Wireframe components
  "wf-button": {
    outline: (w, h) => [rect(0, 0, w, h, Math.min(10, h / 3, w / 4))],
    text: (w, h) => inset([0, 0, w, h], Math.min(10, h / 3, w / 4) * 0.35),
    defaults: { w: 160, h: 48, color: "#dce5f7", fontSize: 16 },
  },
  "wf-input": {
    outline: box,
    text: (w, h) => field(w, h, w),
    defaults: { w: 280, h: 48, ...WF, textAlign: "left" },
  },
  "wf-checkbox": {
    bare: true,
    outline: box,
    text: labelAfter(1),
    detail(ctx, w, h) {
      const c = control(w, h);
      roundBox(ctx, c.x, c.y, c.s, c.s, c.s * 0.2);
      ctx.lineWidth = Math.max(1, c.s * 0.08);
      ctx.strokeStyle = INK;
      ctx.stroke();
      strokeLine(
        ctx,
        [
          [c.x + c.s * 0.24, c.y + c.s * 0.52],
          [c.x + c.s * 0.43, c.y + c.s * 0.7],
          [c.x + c.s * 0.77, c.y + c.s * 0.3],
        ],
        Math.max(1, c.s * 0.1),
      );
    },
    defaults: { w: 200, h: 36, ...WF, textAlign: "left" },
  },
  "wf-radio": {
    bare: true,
    outline: box,
    text: labelAfter(1),
    // Unselected: a group of radio buttons has one choice at most, and
    // forms start with none, so a group of these never shows two chosen.
    detail: radio,
    defaults: { w: 200, h: 36, ...WF, textAlign: "left" },
  },
  // The one chosen option in a group.
  "wf-radio-selected": {
    bare: true,
    outline: box,
    text: labelAfter(1),
    detail(ctx, w, h) {
      const c = radio(ctx, w, h),
        r = c.s / 2;
      fillOval(ctx, c.x + r, c.y + r, r * 0.45, r * 0.45, INK);
    },
    defaults: { w: 200, h: 36, ...WF, textAlign: "left" },
  },
  "wf-toggle": {
    bare: true,
    outline: box,
    text: labelAfter(1.8),
    detail(ctx, w, h) {
      const c = control(w, h, 1.8);
      roundBox(ctx, c.x, c.y, c.s * 1.8, c.s, c.s / 2);
      ctx.fillStyle = DARK;
      ctx.fill();
      fillOval(
        ctx,
        c.x + c.s * 1.3,
        c.y + c.s / 2,
        c.s * 0.38,
        c.s * 0.38,
        "#ffffff",
      );
    },
    defaults: { w: 200, h: 36, ...WF, textAlign: "left" },
  },
  "wf-dropdown": {
    outline: box,
    text(w, h) {
      return field(w, h, w - Math.min(h * 0.3, w * 0.1) * 3);
    },
    detail(ctx, w, h) {
      const c = Math.min(h * 0.3, w * 0.1),
        x = w - c * 1.6,
        y = h / 2;
      strokeLine(
        ctx,
        [
          [x - c / 2, y - c / 4],
          [x, y + c / 4],
          [x + c / 2, y - c / 4],
        ],
        Math.max(1, c * 0.14),
      );
    },
    defaults: { w: 280, h: 48, ...WF, textAlign: "left" },
  },
  "wf-search": {
    outline: (w, h) => [rect(0, 0, w, h, Math.min(w, h) / 2)],
    // Wide bars put the magnifier before the label; the magnifier and gaps
    // scale with both sides, so the label keeps its room as the bar
    // narrows. Narrower bars stack the label below the magnifier.
    text(w, h) {
      const { g, x, gap, right } = searchParts(w, h);
      if (w < h * 1.5) {
        // Inside the rounded ends, and below the magnifier.
        const top = Math.max(h * 0.25, h * 0.06 + g + h * 0.04);
        return [w * 0.25, top, w * 0.5, Math.max(0, h * 0.75 - top)];
      }
      const left = x + g + gap;
      return [left, h * 0.2, Math.max(0, w - left - right), h * 0.6];
    },
    detail(ctx, w, h, tools) {
      const { g, x } = searchParts(w, h);
      tools.glyph(
        "search",
        w < h * 1.5 ? (w - g) / 2 : x,
        w < h * 1.5 ? h * 0.06 : (h - g) / 2,
        g,
      );
    },
    defaults: { w: 280, h: 44, ...WF, textAlign: "left" },
  },
  "wf-navbar": {
    outline: box,
    text(w, h) {
      const d = Math.min(h * 0.5, w * 0.12),
        x = Math.min(h * 0.3, w * 0.05),
        side = x * 2 + d;
      return inset([side, 0, w - side * 2, h], R(w, h) * 0.35);
    },
    detail(ctx, w, h) {
      const d = Math.min(h * 0.5, w * 0.12),
        x = Math.min(h * 0.3, w * 0.05);
      fillOval(ctx, x + d / 2, h / 2, d / 2, d / 2, TONE);
      const right = w - x - d,
        lw = Math.max(1, d * 0.1);
      for (let n = 0; n < 3; n++)
        strokeLine(
          ctx,
          [
            [right + d * 0.1, h / 2 + (n - 1) * d * 0.28],
            [right + d * 0.9, h / 2 + (n - 1) * d * 0.28],
          ],
          lw,
        );
    },
    defaults: { w: 320, h: 56, color: "#e6ebdf", fontSize: 16, bold: true },
  },
  "wf-tabbar": {
    outline: box,
    text: (w, h) => inset([0, h * 0.5, w, h * 0.5], R(w, h) * 0.35),
    detail(ctx, w, h) {
      const s = Math.min(h * 0.26, w * 0.1);
      for (let n = 0; n < 4; n++) {
        roundBox(
          ctx,
          (w * (n + 0.5)) / 4 - s / 2,
          h * 0.28 - s / 2,
          s,
          s,
          s * 0.25,
        );
        if (n) {
          ctx.lineWidth = Math.max(1, s * 0.08);
          ctx.strokeStyle = INK;
          ctx.stroke();
        } else {
          ctx.fillStyle = DARK;
          ctx.fill();
        }
      }
    },
    defaults: { w: 320, h: 64, color: "#e6ebdf", fontSize: 12 },
  },
  "wf-card": {
    outline: box,
    text: (w, h) => inset([0, h * 0.5, w, h * 0.5], R(w, h) * 0.35 + 2),
    detail(ctx, w, h, tools) {
      ctx.fillStyle = "#e6ebdf";
      ctx.fillRect(0, 0, w, h * 0.46);
      strokeLine(
        ctx,
        [
          [0, h * 0.46],
          [w, h * 0.46],
        ],
        1,
        LINE,
      );
      const g = Math.min(h * 0.2, w * 0.3);
      tools.glyph("image", w / 2 - g / 2, h * 0.23 - g / 2, g, LINE);
    },
    defaults: { w: 280, h: 240, ...WF, textAlign: "left" },
  },
  "wf-image": {
    outline: box,
    text: (w, h) => inset([0, h * 0.7, w, h * 0.3], R(w, h) * 0.35),
    detail(ctx, w, h, tools) {
      const g = Math.min(h * 0.4, w * 0.4);
      tools.glyph("image", w / 2 - g / 2, h * 0.4 - g / 2, g, "#7d857a");
    },
    defaults: { w: 280, h: 160, color: "#e6ebdf" },
  },
  "wf-avatar": {
    outline: circle,
    text: (w, h) => centered(w, h, 0.22),
    detail(ctx, w, h, tools) {
      if (tools.item.text) return;
      fillOval(ctx, w / 2, h * 0.4, w * 0.18, h * 0.18, "#aab3a6");
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.9, w * 0.28, h * 0.26, 0, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = "#aab3a6";
      ctx.fill();
    },
    defaults: { w: 64, h: 64, color: "#e6ebdf" },
  },
  "wf-modal": {
    outline: (w, h) => [rect(0, 0, w, h, Math.min(12, w / 4, h / 4))],
    text(w, h) {
      const m = modal(w, h);
      return inset(
        [0, m.header, w, h - m.header - m.button - m.pad * 2],
        m.pad * 0.5,
      );
    },
    detail(ctx, w, h) {
      const m = modal(w, h);
      strokeLine(
        ctx,
        [
          [0, m.header],
          [w, m.header],
        ],
        1,
        LINE,
      );
      const c = m.header / 2,
        x = w - m.header / 2,
        s = m.header * 0.14;
      strokeLine(
        ctx,
        [
          [x - s, c - s],
          [x + s, c + s],
        ],
        1.5,
      );
      strokeLine(
        ctx,
        [
          [x + s, c - s],
          [x - s, c + s],
        ],
        1.5,
      );
      strokeLine(
        ctx,
        [
          [m.pad, c],
          [Math.max(m.pad, w * 0.45), c],
        ],
        Math.max(2, m.header * 0.14),
        TONE,
      );
      for (let n = 0; n < 2; n++) {
        const bx = w - m.pad * (n + 1) - m.buttonW * (n + 1);
        roundBox(
          ctx,
          bx,
          h - m.pad - m.button,
          m.buttonW,
          m.button,
          m.button * 0.25,
        );
        if (n) {
          ctx.lineWidth = 1;
          ctx.strokeStyle = INK;
          ctx.stroke();
        } else {
          ctx.fillStyle = DARK;
          ctx.fill();
        }
      }
    },
    defaults: { w: 360, h: 240, ...WF },
  },
  "wf-phone": device("wf-phone"),
  "wf-tablet": device("wf-tablet"),
  "wf-slider": {
    bare: true,
    outline: box,
    text: (w, h) => inset([w * 0.72, 0, w * 0.28, h], R(w, h) * 0.35),
    detail(ctx, w, h) {
      const r = Math.min(h * 0.3, w * 0.06),
        x0 = r + Math.min(h * 0.1, w * 0.02),
        x1 = w * 0.68,
        knob = x0 + (x1 - x0) * 0.45,
        t = Math.max(2, h * 0.14);
      roundBox(ctx, x0, h / 2 - t / 2, x1 - x0, t, t / 2);
      ctx.fillStyle = TONE;
      ctx.fill();
      roundBox(ctx, x0, h / 2 - t / 2, knob - x0, t, t / 2);
      ctx.fillStyle = DARK;
      ctx.fill();
      fillOval(ctx, knob, h / 2, r, r, "#ffffff");
      strokeOval(ctx, knob, h / 2, r, r, Math.max(1, r * 0.15), DARK);
    },
    defaults: { w: 240, h: 36, ...WF },
  },
  "wf-progress": {
    bare: true,
    outline: box,
    text: (w, h) => inset([w * 0.76, 0, w * 0.24, h], R(w, h) * 0.35),
    detail(ctx, w, h) {
      const t = h * 0.4;
      roundBox(ctx, 1, h * 0.3, w * 0.72, t, t / 2);
      ctx.fillStyle = TONE;
      ctx.fill();
      roundBox(ctx, 1, h * 0.3, w * 0.72 * 0.6, t, t / 2);
      ctx.fillStyle = DARK;
      ctx.fill();
    },
    defaults: { w: 240, h: 28, ...WF, fontSize: 14 },
  },
  "wf-pagination": {
    bare: true,
    outline: box,
    text(w, h) {
      const p = pages(w, h),
        left = p.end + p.gap;
      return inset([left, 0, w - left, h], R(w, h) * 0.35);
    },
    detail(ctx, w, h) {
      const p = pages(w, h);
      ["‹", "1", "2", "3", "›"].forEach((label, n) => {
        const x = p.x + n * (p.s + p.gap);
        roundBox(ctx, x, (h - p.s) / 2, p.s, p.s, p.s * 0.2);
        if (n === 1) {
          ctx.fillStyle = DARK;
          ctx.fill();
        } else {
          ctx.lineWidth = 1;
          ctx.strokeStyle = LINE;
          ctx.stroke();
        }
        ctx.fillStyle = n === 1 ? "#ffffff" : INK;
        ctx.font = `500 ${Math.max(1, p.s * 0.5)}px "DM Sans", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x + p.s / 2, h / 2 + p.s * 0.03);
      });
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
    },
    defaults: { w: 260, h: 40, ...WF, fontSize: 14, textAlign: "left" },
  },
  "wf-paragraph": {
    bare: true,
    outline: box,
    text: full,
    detail(ctx, w, h, tools) {
      if (tools.item.text) return;
      const line = Math.min(24, Math.max(4, h / 3)),
        count = Math.max(1, Math.floor(h / line)),
        widths = [1, 0.94, 0.98, 0.62];
      for (let n = 0; n < count; n++) {
        const width = (n === count - 1 ? 0.62 : widths[n % 3]) * (w - 4);
        roundBox(
          ctx,
          2,
          n * line + line * 0.3,
          width,
          line * 0.42,
          line * 0.21,
        );
        ctx.fillStyle = TONE;
        ctx.fill();
      }
    },
    defaults: { w: 280, h: 80, ...WF, textAlign: "left" },
  },
};
// Compact symbols shrink their label to fit instead of clipping it.
for (const key of [
  "or",
  "summing-junction",
  "off-page",
  "merge",
  "touchpoint",
  "pain-point",
  "emotion-high",
  "emotion-neutral",
  "emotion-low",
  "start-event",
  "intermediate-event",
  "end-event",
  "gateway-exclusive",
  "gateway-parallel",
  "gateway-inclusive",
  "data-object",
  "actor",
  "mobile",
  "wf-avatar",
])
  Object.assign(SHAPE_SPECS[key].defaults, {
    fontSize: 14,
    autoFontSize: true,
  });
function gateway(marker) {
  return {
    outline: (w, h) => [
      [
        [w / 2, 0],
        [w, h / 2],
        [w / 2, h],
        [0, h / 2],
      ],
    ],
    // Below the marker and inside the diamond, room for a short label
    // such as Yes or No at the default size.
    text: (w, h) => [w * 0.25, h * 0.53, w * 0.5, h * 0.22],
    detail: (ctx, w, h) =>
      marker(ctx, w, h, Math.max(1.5, Math.min(w, h) * 0.04)),
    defaults: { w: 70, h: 70, color: "#f6e7a4" },
  };
}
function page(defaults) {
  const fold = (w, h) => Math.min(w * 0.3, h * 0.3);
  return {
    outline(w, h) {
      const r = R(w, h),
        f = fold(w, h);
      return [
        rounded([
          [0, 0, r],
          [w - f, 0],
          [w, f],
          [w, h, r],
          [0, h, r],
        ]),
      ];
    },
    text(w, h) {
      const f = fold(w, h);
      return inset([0, f, w, h - f], R(w, h) * 0.35 + 1);
    },
    detail(ctx, w, h) {
      const f = fold(w, h);
      strokeLine(
        ctx,
        [
          [w - f, 0],
          [w - f, f],
          [w, f],
        ],
        1,
        LINE,
      );
    },
    defaults,
  };
}
function modal(w, h) {
  const header = Math.min(h * 0.22, 56),
    pad = Math.min(h * 0.05, w * 0.04, 16),
    button = Math.min(h * 0.16, 40),
    buttonW = Math.min(w * 0.22, 100);
  return { header, pad, button, buttonW };
}
function pages(w, h) {
  const s = Math.min(h * 0.8, w * 0.12),
    gap = s * 0.2,
    x = Math.min((h - s) / 2, w * 0.02);
  return { s, gap, x, end: x + s * 5 + gap * 4 };
}
// Polygon lists are cached per size; hit tests and anchors reuse them. The
// cache holds a full board's shapes and drops the least recently used, so
// sizes passed through while resizing go first and a large board's shapes
// stay cached from one frame to the next.
const cache = new Map();
export function shapeOutline(key, w, h) {
  const id = `${key}|${w}|${h}`;
  let polygons = cache.get(id);
  if (polygons) {
    cache.delete(id);
    cache.set(id, polygons);
  } else {
    polygons = SHAPE_SPECS[key].outline(w, h);
    cache.set(id, polygons);
    if (cache.size > 6000) cache.delete(cache.keys().next().value);
  }
  return polygons;
}
export function polygonContains(points, x, y) {
  let inside = false;
  for (let n = 0, p = points.length - 1; n < points.length; p = n++) {
    const [ax, ay] = points[p],
      [bx, by] = points[n];
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax),
      scale = Math.abs(bx - ax) + Math.abs(by - ay);
    if (
      Math.abs(cross) <= 1e-9 * (scale + 1) &&
      x >= Math.min(ax, bx) - 1e-9 &&
      x <= Math.max(ax, bx) + 1e-9 &&
      y >= Math.min(ay, by) - 1e-9 &&
      y <= Math.max(ay, by) + 1e-9
    )
      return true;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  return inside;
}
// The farthest silhouette crossing along the ray from the center, so lines
// stop at the outer edge of unions such as stacked documents.
export function outlineAnchor(polygons, cx, cy, dx, dy) {
  let distance = 0;
  for (const points of polygons)
    for (let n = 0; n < points.length; n++) {
      const [ax, ay] = points[n],
        [bx, by] = points[(n + 1) % points.length];
      const sx = bx - ax,
        sy = by - ay,
        denominator = dx * sy - dy * sx;
      if (denominator === 0) continue;
      const t = ((ax - cx) * sy - (ay - cy) * sx) / denominator,
        u = ((ax - cx) * dy - (ay - cy) * dx) / denominator;
      if (t >= 0 && u >= -1e-12 && u <= 1 + 1e-12)
        distance = Math.max(distance, t);
    }
  return distance;
}
