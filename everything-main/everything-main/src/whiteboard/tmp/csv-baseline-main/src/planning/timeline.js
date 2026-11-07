import "./i18n.js";
import { item, uid } from "../model.js";
import { language, t } from "../i18n.js";
import {
  STATUS_LABELS,
  dayNumber,
  dateFromDay,
  formatDate,
  localDate,
  dependencyEdges,
} from "./task.js";
import { groupTasks } from "./tasks.js";
import { canonicalLanguage } from "../accessibility/language-tag.js";
import { appendRun, sliceTextRuns } from "../rich-text.js";

// Bars and lanes show a task's opening words; its full text stays on the
// task, and long text would exceed an object's text limit.
function short(value, sourceLanguage, sourceRuns = [], max = 200) {
  let end = value.length;
  if (end > max) {
    end = max - 1;
    if (
      /[\uD800-\uDBFF]/.test(value[end - 1]) &&
      /[\uDC00-\uDFFF]/.test(value[end])
    )
      end--;
    end = value.slice(0, end).trimEnd().length;
  }
  const lang = canonicalLanguage(sourceLanguage),
    runs = [];
  for (const run of sliceTextRuns(sourceRuns, 0, end)) {
    const tag = canonicalLanguage(run.style.lang);
    if (tag) appendRun(runs, run.start, run.end, { lang: tag });
  }
  return {
    text: value.slice(0, end) + (value.length > max ? "…" : ""),
    ...(lang ? { lang } : {}),
    ...(runs.length ? { textRuns: runs } : {}),
  };
}

export const BAR_COLORS = {
  todo: "#e3e7ec",
  "in-progress": "#dce5f7",
  blocked: "#f3d6c8",
  done: "#d9e9d2",
};

// Ticks at a readable density: days for a month, Mondays for half a year,
// months for about a year, quarters for a few years, and whole years at a
// step that keeps about a dozen labels beyond that.
const monthDay = (year, month) => {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 1);
  return Math.round(date.getTime() / 86400000);
};
function ticks(first, last, lang) {
  const span = last - first + 1,
    out = [];
  // The padding day after 9999-12-31 is not a date that can be labelled.
  last = Math.min(last, dayNumber("9999-12-31"));
  if (span <= 190) {
    const unit = span <= 31 ? "day" : "week";
    for (let day = first; day <= last; day++)
      if (unit === "day" || new Date(day * 86400000).getUTCDay() === 1)
        out.push({ day, label: formatDate(dateFromDay(day), lang) });
    // Daily labels thin out on longer ranges so they stay legible.
    const step = unit === "day" && span > 14 ? 2 : 1;
    return { unit, ticks: out.filter((_, n) => n % step === 0) };
  }
  const start = new Date(first * 86400000),
    year = start.getUTCFullYear();
  if (span <= 1100) {
    const unit = span <= 400 ? "month" : "quarter",
      months = unit === "month" ? 1 : 3;
    let month = start.getUTCMonth();
    month = Math.ceil(month / months) * months;
    if (monthDay(year, month) < first) month += months;
    for (let day; (day = monthDay(year, month)) <= last; month += months)
      out.push({
        day,
        // Without the day the default options would add.
        label: formatDate(dateFromDay(day), lang, {
          month: "short",
          year: "numeric",
          day: undefined,
        }),
      });
    return { unit, ticks: out };
  }
  const years = span / 365.25,
    step =
      [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find(
        (s) => years / s <= 12,
      ) || 5000;
  let y = Math.ceil(year / step) * step;
  if (monthDay(y, 0) < first) y += step;
  for (let day; (day = monthDay(y, 0)) <= last; y += step)
    out.push({ day, label: String(y) });
  return { unit: "year", ticks: out };
}

// Bars run from the start to the due date, inclusive. Tasks with only one
// date become one-day bars; undated tasks are listed separately.
export function timelineModel(rows, options = {}) {
  const lang = options.language || language,
    today = options.today || localDate(),
    groupBy = options.groupBy || "assignee";
  const scheduled = [],
    unscheduled = [];
  for (const row of rows) {
    if (!row.start && !row.due) {
      unscheduled.push(row);
      continue;
    }
    const start = dayNumber(row.start || row.due),
      end = dayNumber(row.due || row.start);
    scheduled.push({ row, start, end });
  }
  if (!scheduled.length)
    return {
      lanes: [],
      unscheduled,
      first: null,
      last: null,
      ticks: [],
      edges: [],
    };
  const todayDay = dayNumber(today);
  let first = Math.min(...scheduled.map((b) => b.start)),
    last = Math.max(...scheduled.map((b) => b.end));
  if (todayDay >= first - 14 && todayDay <= last + 14) {
    first = Math.min(first, todayDay);
    last = Math.max(last, todayDay);
  }
  first -= 1;
  last += 1;
  const span = last - first + 1;
  const percent = (day) => ((day - first) / span) * 100;
  const byRow = new Map(scheduled.map((b) => [b.row.id, b]));
  const lanes = groupTasks(
    scheduled.map((b) => b.row),
    groupBy === "frame"
      ? "frame"
      : groupBy === "status"
        ? "status"
        : "assignee",
  ).map((group) => ({
    key: group.key,
    label: group.label,
    ...(groupBy === "frame"
      ? {
          labelGenerated: group.labelGenerated,
          labelLang: group.labelLang,
          labelRuns: group.labelRuns,
        }
      : {}),
    bars: group.rows
      .map((row) => byRow.get(row.id))
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .map((b) => ({
        ...b,
        left: percent(b.start),
        width: ((b.end - b.start + 1) / span) * 100,
        label: `${b.row.title}, ${t(STATUS_LABELS[b.row.status], "task")}, ${formatDate(dateFromDay(b.start), lang)} ${t("to")} ${formatDate(dateFromDay(b.end), lang)}`,
      })),
  }));
  const ids = new Set(scheduled.map((b) => b.row.id));
  return {
    lanes,
    unscheduled,
    first,
    last,
    span,
    today: todayDay >= first && todayDay <= last ? percent(todayDay) : null,
    todayDay,
    ...ticks(first, last, lang),
    edges: (options.edges || []).filter(
      (e) => ids.has(e.from) && ids.has(e.to),
    ),
    percent,
  };
}

// An editable timeline frame for the canvas: a date header, one lane per
// group, a bar per task linked to its object, a today marker, and
// dependency connectors between bars.
export function timelineItems(board, rows, options = {}) {
  const model = timelineModel(rows, {
    ...options,
    edges: dependencyEdges(board.items),
  });
  if (!model.lanes.length)
    throw Error("Add start or due dates to tasks first.");
  const origin = options.origin || { x: 0, y: 0 };
  // Days get at least 4 pixels until the chart would pass 24,000 pixels,
  // so a date far in the future cannot make the frame unusably wide.
  const dayW = Math.min(
      60,
      Math.max(1400 / model.span, Math.min(4, 24000 / model.span)),
    ),
    labelW = 180,
    header = 96,
    rowH = 44,
    barH = 34,
    lanePad = 10,
    chartW = model.span * dayW;
  const x0 = origin.x + labelW + 20,
    dayX = (day) => x0 + (day - model.first) * dayW;
  const lanesH = model.lanes.reduce(
    (sum, lane) => sum + lane.bars.length * rowH + lanePad * 2,
    0,
  );
  const frame = item("frame", origin.x, origin.y, {
    w: labelW + 40 + chartW,
    h: header + lanesH + 30,
    text: options.title || t("Timeline"),
    ...(!options.title ? { lang: language } : {}),
    color: "#ffffff",
    order: board.items.filter((i) => i.type === "frame").length,
  });
  const inside = (i) => ({ ...i, parentId: frame.id });
  const items = [frame];
  const text = (x, y, w, h, value, extra = {}) =>
    inside(
      item("text", x, y, {
        w,
        h,
        text: value,
        fontSize: 13,
        color: "#30342f",
        ...extra,
      }),
    );
  // Lane backgrounds first so labels and bars stack above them.
  let y = origin.y + header;
  const laneTops = [];
  model.lanes.forEach((lane, n) => {
    const h = lane.bars.length * rowH + lanePad * 2;
    laneTops.push(y);
    items.push(
      inside(
        item("rect", origin.x + 10, y, {
          w: labelW + 20 + chartW,
          h,
          color: n % 2 ? "#ffffff" : "#f3f5f8",
          text: "",
        }),
      ),
    );
    y += h;
  });
  for (const tick of model.ticks)
    items.push(
      text(
        dayX(tick.day),
        origin.y + 56,
        Math.max(60, dayW * 2),
        30,
        tick.label,
        {
          fontSize: 12,
          // Match formatDate's supported interface language codes.
          lang: (options.language || language) === "fr" ? "fr-CA" : "en-CA",
        },
      ),
    );
  if (model.today !== null) {
    const x = dayX(model.todayDay) + dayW / 2 - 1;
    items.push(
      inside(
        item("rect", x, origin.y + header - 8, {
          w: 2,
          h: lanesH + 8,
          color: "#b3261e",
          text: "",
        }),
      ),
      text(x + 4, origin.y + header - 30, 90, 22, t("Today"), {
        fontSize: 12,
        textColor: "#8c1d18",
        bold: true,
        lang: language,
      }),
    );
  }
  const bars = new Map();
  model.lanes.forEach((lane, n) => {
    const generated =
      lane.labelGenerated ||
      options.groupBy === "status" ||
      (options.groupBy !== "frame" && !lane.key);
    const caption = short(
      lane.label,
      generated ? language : lane.labelLang,
      generated ? [] : lane.labelRuns,
    );
    items.push(
      text(
        origin.x + 20,
        laneTops[n] + lanePad,
        labelW - 20,
        40,
        caption.text,
        {
          bold: true,
          fontSize: 14,
          ...caption,
        },
      ),
    );
    lane.bars.forEach((b, m) => {
      const title = short(
        b.row.title,
        b.row.titleGenerated ? language : b.row.titleLang,
        b.row.titleGenerated ? [] : b.row.titleRuns,
      );
      const status = ` (${t(STATUS_LABELS[b.row.status], "task")})`;
      title.textRuns ||= [];
      appendRun(
        title.textRuns,
        title.text.length,
        title.text.length + status.length,
        { lang: language },
      );
      title.text += status;
      const bar = inside(
        item("rect", dayX(b.start), laneTops[n] + lanePad + m * rowH + 5, {
          w: Math.max(dayW, 4, (b.end - b.start + 1) * dayW),
          h: barH,
          ...title,
          fontSize: 12,
          color: BAR_COLORS[b.row.status],
          autoFontSize: true,
          objectLink: { objectId: b.row.id },
        }),
      );
      bars.set(b.row.id, bar);
      items.push(bar);
    });
  });
  for (const edge of model.edges) {
    const a = bars.get(edge.from),
      b = bars.get(edge.to);
    items.push(
      inside({
        id: uid(),
        type: "arrow",
        x: a.x + a.w,
        y: a.y + a.h / 2,
        w: b.x - a.x - a.w,
        h: b.y - a.y,
        text: "",
        color: "#5f6b7a",
        lineType: "elbow",
        startId: a.id,
        endId: b.id,
      }),
    );
  }
  return { items, frame, model };
}
