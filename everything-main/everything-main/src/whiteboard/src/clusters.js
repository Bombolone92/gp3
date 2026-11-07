import { item, uid, bounds, COLORS, MAX_OBJECTS } from "./model.js";
import { assertUnlocked } from "./locking.js";
import { remapObjectLink } from "./object-link-data.js";
import { nextFrameOrder, updateConnectors } from "./scene.js";
import { canonicalLanguage } from "./accessibility/language-tag.js";
import { appendRun, sliceTextRuns, validateTextRuns } from "./rich-text.js";

// Plans retain geometry, identifiers and frame captions, never cloned note text.
// Copies are made from the latest note content at application.
export function planClusters(
  board,
  ids,
  mode = "color",
  title = "Cluster",
  labels = {},
) {
  if (!["color", "tag", "one", "themes"].includes(mode))
    throw Error("Choose a clustering method.");
  const notes = board.items.filter((i) => ids.has(i.id) && i.type === "note");
  if (!notes.length) throw Error("Select sticky notes first.");
  if (notes.length !== ids.size)
    throw Error("The selected notes changed. Reopen clustering.");
  assertUnlocked(board.items, ids);
  if (notes.some((i) => i.mindMap))
    throw Error("Select sticky notes outside a mind map.");
  if (mode === "one" && (!title.trim() || title.trim().length > 200))
    throw Error("Enter a cluster name of up to 200 characters.");
  const catalog = new Map((board.tags || []).map((t) => [t.id, t])),
    groups = new Map();
  notes.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  for (const note of notes) {
    // Themes (for example from AI grouping) name the notes they contain.
    const keys =
      mode === "themes"
        ? (labels.themes || [])
            .map((theme, n) =>
              theme.ids.includes(note.id) ? String(n).padStart(4, "0") : null,
            )
            .filter(Boolean)
        : mode === "tag"
          ? (note.tagIds || []).filter((id) => catalog.has(id)).sort()
          : [
              mode === "color"
                ? (note.color || "#f6e7a4").toLowerCase()
                : "one",
            ];
    if (!keys.length) keys.push("");
    for (const key of keys) {
      if (!groups.has(key))
        groups.set(key, {
          key,
          title:
            mode === "one"
              ? title.trim()
              : mode === "themes"
                ? String(
                    // Notes in no theme gather under Other, not the first theme.
                    (key && labels.themes?.[Number(key)]?.name) ||
                      labels.other ||
                      "Other",
                  ).slice(0, 200)
                : mode === "tag"
                  ? catalog.get(key)?.name || labels.noTag || "No tag"
                  : "",
          color:
            mode === "color"
              ? key
              : mode === "themes"
                ? key
                  ? COLORS[Number(key) % 5]
                  : "#667069"
                : catalog.get(key)?.color || "#667069",
          notes: [],
        });
      groups.get(key).notes.push(note);
    }
  }
  const entries = [...groups.values()].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  const captureLanguage = (group, value) => {
    const lang = canonicalLanguage(value);
    if (lang) group.lang = lang;
  };
  for (const group of entries) {
    const theme =
      mode === "themes" && group.key && labels.themes?.[Number(group.key)];
    const content = theme?.name
      ? { text: String(theme.name), lang: theme.lang, textRuns: theme.textRuns }
      : mode === "one"
        ? labels.titleContent
        : null;
    if (content) {
      const text = String(content.text || "");
      if (mode === "one" && text !== group.title)
        throw Error("The cluster name changed. Reopen clustering.");
      if (
        /[\uD800-\uDBFF]$/.test(group.title) &&
        /[\uDC00-\uDFFF]/.test(text[group.title.length] || "")
      )
        group.title = group.title.slice(0, -1);
      captureLanguage(group, content.lang);
      validateTextRuns(text, content.textRuns);
      const runs = [];
      for (const run of sliceTextRuns(
        content.textRuns,
        0,
        group.title.length,
      )) {
        const lang = canonicalLanguage(run.style.lang);
        if (lang) appendRun(runs, run.start, run.end, { lang });
      }
      if (runs.length) group.textRuns = runs;
    }
    if (mode === "tag" && !catalog.get(group.key)?.name)
      captureLanguage(group, labels.noTag ? labels.language : "en");
    if (
      mode === "themes" &&
      !(group.key && labels.themes?.[Number(group.key)]?.name)
    )
      captureLanguage(group, labels.other ? labels.language : "en");
  }
  if (mode === "color")
    entries.forEach((g, index) => {
      const palette = labels.palette || [
        "Butter",
        "Sage",
        "Blue",
        "Lilac",
        "Peach",
        "White",
      ];
      const name = palette[COLORS.indexOf(g.key)];
      g.title = name || `${labels.color || "Color"} ${index + 1}`;
      captureLanguage(
        g,
        name
          ? labels.palette
            ? labels.language
            : "en"
          : labels.color
            ? labels.language
            : "en",
      );
    });
  const copies = entries.reduce((n, g) => n + g.notes.length, 0) - notes.length;
  if (board.items.length + entries.length + copies > MAX_OBJECTS)
    throw Error(
      "These clusters would exceed the board limit of 5,000 objects.",
    );
  for (const group of entries) {
    const cols = Math.ceil(Math.sqrt(group.notes.length)),
      rows = Math.ceil(group.notes.length / cols);
    const widths = Array(cols).fill(0),
      heights = Array(rows).fill(0);
    group.notes.forEach((n, index) => {
      widths[index % cols] = Math.max(widths[index % cols], Math.abs(n.w));
      heights[Math.floor(index / cols)] = Math.max(
        heights[Math.floor(index / cols)],
        Math.abs(n.h),
      );
    });
    const starts = (sizes, initial) => {
      let next = initial;
      return sizes.map((size) => {
        const at = next;
        next += size + 24;
        return at;
      });
    };
    const xs = starts(widths, 30),
      ys = starts(heights, 65);
    group.w = widths.reduce((a, b) => a + b, 0) + (cols - 1) * 24 + 60;
    group.h = heights.reduce((a, b) => a + b, 0) + (rows - 1) * 24 + 95;
    group.members = group.notes.map((n, index) => ({
      id: n.id,
      x: xs[index % cols] - Math.min(0, n.w),
      y: ys[Math.floor(index / cols)] - Math.min(0, n.h),
    }));
    delete group.notes;
  }
  const origin = bounds(notes),
    cols = Math.ceil(Math.sqrt(entries.length));
  const widths = Array(cols).fill(0),
    heights = Array(Math.ceil(entries.length / cols)).fill(0);
  entries.forEach((g, n) => {
    widths[n % cols] = Math.max(widths[n % cols], g.w);
    heights[Math.floor(n / cols)] = Math.max(
      heights[Math.floor(n / cols)],
      g.h,
    );
  });
  let y = origin.y;
  for (let row = 0; row < heights.length; row++) {
    let x = origin.x;
    for (let col = 0; col < cols; col++) {
      const g = entries[row * cols + col];
      if (!g) break;
      Object.assign(g, { x, y });
      x += widths[col] + 80;
    }
    y += heights[row] + 80;
  }
  // Keep the cluster block near the notes, using the closest free horizontal
  // or vertical lane. Geometry-only scans avoid measuring unrelated content.
  const block = bounds(entries);
  const obstacles = board.items
    .filter(
      (i) =>
        !ids.has(i.id) &&
        !(i.type === "arrow" && (ids.has(i.startId) || ids.has(i.endId))),
    )
    .map((i) => ({
      x: Math.min(i.x, i.x + i.w),
      y: Math.min(i.y, i.y + i.h),
      w: Math.abs(i.w),
      h: Math.abs(i.h),
    }));
  const lane = (axis, cross, size, crossSize) => {
    let at = block[axis];
    const candidates = obstacles
      .filter(
        (o) =>
          o[cross] < block[cross] + block[crossSize] + 80 &&
          o[cross] + o[crossSize] + 80 > block[cross],
      )
      .sort((a, b) => a[axis] - b[axis]);
    for (const o of candidates) {
      if (o[axis] + o[size] + 80 <= at) continue;
      if (at + block[size] + 80 <= o[axis]) break;
      at = o[axis] + o[size] + 80;
    }
    return at - block[axis];
  };
  const dx = lane("x", "y", "w", "h"),
    dy = lane("y", "x", "h", "w");
  const across = block.x + dx + block.w <= 1e6,
    down = block.y + dy + block.h <= 1e6;
  const horizontal = across && (!down || dx <= dy);
  for (const g of entries) {
    g.x += horizontal ? dx : 0;
    g.y += horizontal ? 0 : dy;
  }
  if (
    entries.some((g) =>
      [g.x, g.y, g.w, g.h, g.x + g.w, g.y + g.h].some(
        (v) => !Number.isFinite(v) || Math.abs(v) > 1e6,
      ),
    )
  )
    throw Error("These clusters would exceed the board geometry limit.");
  return {
    groups: entries,
    copies,
    count: notes.length,
    mode,
    title,
    labels,
    signature: JSON.stringify([
      board.items.length,
      notes.map((n) => [
        n.id,
        n.x,
        n.y,
        n.w,
        n.h,
        n.color,
        n.tagIds,
        n.parentId,
        n.groupId,
      ]),
      entries,
    ]),
  };
}

export function applyClusters(board, plan) {
  const selected = new Set(
    plan.groups.flatMap((g) => g.members.map((m) => m.id)),
  );
  if (
    planClusters(board, selected, plan.mode, plan.title, plan.labels)
      .signature !== plan.signature
  )
    throw Error("The selected notes changed. Reopen clustering.");
  const byId = new Map(board.items.map((i) => [i.id, i])),
    used = new Set(),
    moves = [],
    additions = [],
    frames = [];
  assertUnlocked(
    board.items,
    new Set(plan.groups.flatMap((g) => g.members.map((m) => m.id))),
  );
  if (board.items.length + plan.groups.length + plan.copies > MAX_OBJECTS)
    throw Error(
      "These clusters would exceed the board limit of 5,000 objects.",
    );
  const order = nextFrameOrder(board.items);
  for (const [index, group] of plan.groups.entries()) {
    const frame = item("frame", group.x, group.y, {
      w: group.w,
      h: group.h,
      text: group.title,
      ...(group.lang ? { lang: group.lang } : {}),
      ...(group.textRuns ? { textRuns: structuredClone(group.textRuns) } : {}),
      color: group.color,
      order: order + index,
    });
    frames.push(frame);
    const map = new Map(),
      copies = [];
    for (const member of group.members) {
      const source = byId.get(member.id);
      if (!source || source.type !== "note" || source.mindMap)
        throw Error("The selected notes changed. Reopen clustering.");
      const copy = used.has(source.id);
      const note = copy ? structuredClone(source) : source;
      if (copy) {
        note.id = uid();
        additions.push(note);
        copies.push(note);
      }
      map.set(source.id, note.id);
      used.add(source.id);
      moves.push({
        note,
        x: group.x + member.x,
        y: group.y + member.y,
        parentId: frame.id,
      });
    }
    for (const copy of copies) remapObjectLink(copy, map);
  }
  // All checks and potentially failing cloning occur before the first mutation.
  for (const { note, x, y, parentId } of moves) {
    Object.assign(note, { x, y, parentId });
    delete note.groupId;
  }
  board.items.unshift(...frames);
  board.items.push(...additions);
  updateConnectors(board.items);
  return new Set(frames.map((f) => f.id));
}
