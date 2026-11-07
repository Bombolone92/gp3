import "./i18n.js";
import { fontStack } from "../fonts.js";
import { language, t } from "../i18n.js";
import {
  STATUS_LABELS,
  readTask,
  taskRow,
  localDate,
  isOverdue,
  initials,
  formatDate,
} from "./task.js";

// Tests and exports can pin "today" so overdue highlighting is repeatable.
export const taskClock = { now: () => Date.now() };
export const STATUS_COLORS = {
  todo: "#5f6b7a",
  "in-progress": "#0b62c4",
  blocked: "#b3261e",
  done: "#1e7b3c",
};
const INK = "#30342f";

// Status icons differ in shape as well as color: an empty ring (to do), a
// half-filled ring (in progress), a barred disc (blocked), a checked disc
// (done). Operations are drawn by the canvas, SVG, and PDF renderers.
function statusIcon(status, cx, cy, r, scale) {
  const color = STATUS_COLORS[status],
    width = Math.max(0.75, 1.4 * scale);
  if (status === "todo")
    return [{ op: "circle", cx, cy, r, fill: "#ffffff", stroke: color, width }];
  if (status === "in-progress") {
    const points = [];
    for (let n = 0; n <= 12; n++) {
      const a = -Math.PI / 2 + (Math.PI * n) / 12;
      points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return [
      { op: "circle", cx, cy, r, fill: "#ffffff", stroke: color, width },
      { op: "poly", points, fill: color },
    ];
  }
  if (status === "blocked")
    return [
      { op: "circle", cx, cy, r, fill: color },
      {
        op: "line",
        points: [
          [cx - r * 0.55, cy],
          [cx + r * 0.55, cy],
        ],
        stroke: "#ffffff",
        width: Math.max(1, 1.8 * scale),
      },
    ];
  return [
    { op: "circle", cx, cy, r, fill: color },
    {
      op: "line",
      points: [
        [cx - r * 0.5, cy + r * 0.02],
        [cx - r * 0.12, cy + r * 0.42],
        [cx + r * 0.55, cy - r * 0.38],
      ],
      stroke: "#ffffff",
      width: Math.max(1, 1.6 * scale),
    },
  ];
}

let layouts = new WeakMap();
export const clearTaskLayouts = () => {
  layouts = new WeakMap();
};

// The badge row: status chip, assignee initials, due date (highlighted when
// overdue), and the Jira key. Parts that do not fit are left out in reverse
// order of importance; the status keeps at least its icon.
// Today's date, read at most once a second: badges are laid out per frame.
let day = { at: -Infinity, value: "" };
const currentDay = () => {
  const now = taskClock.now();
  if (Math.abs(now - day.at) >= 1000) day = { at: now, value: localDate(now) };
  return day.value;
};
export function taskLayout(ctx, item, options = {}) {
  const footer = taskRow(item);
  if (!footer) return null;
  const lang = options.language || language,
    today = options.today || currentDay();
  let contexts = layouts.get(item);
  const cached = contexts?.get(ctx);
  // Tasks are replaced, never edited, so the same task object with the same
  // size, language, and day needs no new layout.
  if (
    cached &&
    cached.task === item.task &&
    cached.w === item.w &&
    cached.h === item.h &&
    cached.footer === footer &&
    cached.lang === lang &&
    cached.today === today
  )
    return cached.result;
  const task = readTask(item);
  const signature = [
    item.w,
    item.h,
    footer,
    lang,
    today,
    JSON.stringify(task),
  ].join("\n");
  if (cached?.signature === signature) {
    Object.assign(cached, { task: item.task, w: item.w, h: item.h });
    return cached.result;
  }
  const w = Math.abs(item.w),
    scale = Math.min(1, footer / 26, w / 80),
    h = 18 * scale,
    pad = 6 * scale,
    gap = 4 * scale,
    y = Math.abs(item.h) - footer + (footer - h) / 2,
    mid = y + h / 2,
    font = `500 ${11 * scale}px ${fontStack("dm-sans")}`,
    bold = `600 ${9 * scale}px ${fontStack("dm-sans")}`;
  const ops = [],
    labels = [];
  let x = pad;
  const room = () => w - pad - x;
  const measure = (text, f = font) => {
    ctx.font = f;
    return ctx.measureText(text).width;
  };
  const text = (value, tx, color = INK, f = font, align = "left") => {
    ops.push({
      op: "text",
      text: value,
      x: tx,
      y: mid,
      font: f,
      size: f === font ? 11 * scale : 9 * scale,
      bold: f === bold,
      color,
      align,
    });
    labels.push(value);
  };
  const result = { scale, h, y, footer, ops, labels, task };
  if (h < 7) {
    if (!contexts) layouts.set(item, (contexts = new WeakMap()));
    contexts.set(ctx, {
      signature,
      result,
      task: item.task,
      w: item.w,
      h: item.h,
      footer,
      lang,
      today,
    });
    return result;
  }
  // Status.
  const label = t(STATUS_LABELS[task.status], "task"),
    r = 5 * scale,
    full = 17 * scale + measure(label) + 7 * scale;
  const chipW = full <= room() ? full : Math.min(room(), 18 * scale);
  if (chipW >= 12 * scale) {
    ops.push({
      op: "pill",
      x,
      y,
      w: chipW,
      h,
      r: 4 * scale,
      fill: "#ffffff",
      stroke: STATUS_COLORS[task.status],
      width: scale,
    });
    ops.push(...statusIcon(task.status, x + 9 * scale, mid, r, scale));
    if (chipW === full) text(label, x + 17 * scale);
    x += chipW + gap;
  }
  // Assignee initials in a dark disc.
  if (task.assignee && room() >= h) {
    ops.push({
      op: "circle",
      cx: x + h / 2,
      cy: mid,
      r: h / 2,
      fill: "#3d4a5c",
    });
    text(initials(task.assignee.name), x + h / 2, "#ffffff", bold, "center");
    x += h + gap;
  }
  // Due date.
  if (task.due) {
    // A date in another year shows the year, so "Jan 15" is never two
    // years away, unless only the shorter date fits.
    const overdue = isOverdue(task, today),
      iconW = overdue ? 12 * scale : 0;
    let value = formatDate(task.due, lang),
      dueW = 12 * scale + iconW + measure(value);
    if (task.due.slice(0, 4) !== today.slice(0, 4)) {
      const long = formatDate(task.due, lang, { year: "numeric" }),
        longW = 12 * scale + iconW + measure(long);
      if (longW <= room()) [value, dueW] = [long, longW];
    }
    if (dueW <= room()) {
      ops.push({
        op: "pill",
        x,
        y,
        w: dueW,
        h,
        r: 4 * scale,
        fill: overdue ? "#fde7e4" : "#ffffff",
        stroke: overdue ? "#b3261e" : "#92998d",
        width: scale,
      });
      if (overdue) {
        const cx = x + 10 * scale;
        ops.push(
          { op: "circle", cx, cy: mid, r: 4.5 * scale, fill: "#b3261e" },
          {
            op: "line",
            points: [
              [cx, mid - 2.4 * scale],
              [cx, mid + 0.6 * scale],
            ],
            stroke: "#ffffff",
            width: Math.max(0.8, 1.3 * scale),
          },
          {
            op: "circle",
            cx,
            cy: mid + 2.3 * scale,
            r: 0.75 * scale,
            fill: "#ffffff",
          },
        );
      }
      text(value, x + 6 * scale + iconW, overdue ? "#8c1d18" : INK);
      x += dueW + gap;
    }
  }
  // Jira key.
  if (task.jira?.key) {
    const jiraW = 12 * scale + measure(task.jira.key);
    if (jiraW <= room()) {
      ops.push({
        op: "pill",
        x,
        y,
        w: jiraW,
        h,
        r: 4 * scale,
        fill: "#ffffff",
        stroke: "#0052cc",
        width: scale,
      });
      text(task.jira.key, x + 6 * scale, "#0747a6");
      x += jiraW + gap;
    }
  }
  if (!contexts) layouts.set(item, (contexts = new WeakMap()));
  contexts.set(ctx, {
    signature,
    result,
    task: item.task,
    w: item.w,
    h: item.h,
    footer,
    lang,
    today,
  });
  return result;
}

export function drawTaskBadge(ctx, item) {
  const layout = taskLayout(ctx, item);
  if (!layout?.ops.length) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, Math.abs(item.w), Math.abs(item.h));
  ctx.clip();
  ctx.textBaseline = "middle";
  ctx.setLineDash([]);
  for (const o of layout.ops) {
    if (o.op === "pill") {
      ctx.beginPath();
      ctx.roundRect(o.x, o.y, o.w, o.h, o.r);
      ctx.fillStyle = o.fill;
      ctx.fill();
      ctx.strokeStyle = o.stroke;
      ctx.lineWidth = o.width;
      ctx.stroke();
    } else if (o.op === "circle") {
      ctx.beginPath();
      ctx.arc(o.cx, o.cy, o.r, 0, Math.PI * 2);
      if (o.fill) {
        ctx.fillStyle = o.fill;
        ctx.fill();
      }
      if (o.stroke) {
        ctx.strokeStyle = o.stroke;
        ctx.lineWidth = o.width;
        ctx.stroke();
      }
    } else if (o.op === "poly") {
      ctx.beginPath();
      o.points.forEach(([px, py], n) =>
        n ? ctx.lineTo(px, py) : ctx.moveTo(px, py),
      );
      ctx.closePath();
      ctx.fillStyle = o.fill;
      ctx.fill();
    } else if (o.op === "line") {
      ctx.beginPath();
      o.points.forEach(([px, py], n) =>
        n ? ctx.lineTo(px, py) : ctx.moveTo(px, py),
      );
      ctx.strokeStyle = o.stroke;
      ctx.lineWidth = o.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    } else if (o.op === "text") {
      ctx.font = o.font;
      ctx.fillStyle = o.color;
      ctx.textAlign = o.align;
      ctx.fillText(o.text, o.x, o.y);
    }
  }
  ctx.restore();
}
