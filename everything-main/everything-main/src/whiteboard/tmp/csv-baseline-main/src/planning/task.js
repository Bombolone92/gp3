// Task metadata on board objects: ownership, dates, status, priority, and an
// optional Jira link. Validation is strict; display helpers are lenient so
// hand-written spreadsheet fixtures and older files still render.
export const STATUSES = ["todo", "in-progress", "blocked", "done"];
export const PRIORITIES = ["low", "medium", "high"];
export const DEPENDENCIES = ["blocks", "depends-on"];
export const TASK_TYPES = new Set(["note", "text", "rect", "ellipse"]);
export const STATUS_LABELS = {
  todo: "To do",
  "in-progress": "In progress",
  blocked: "Blocked",
  done: "Done",
};
export const PRIORITY_LABELS = { low: "Low", medium: "Medium", high: "High" };
const TASK_KEYS = ["assignee", "start", "due", "status", "priority", "jira"];
const JIRA_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

export const taskable = (i) => !!i && TASK_TYPES.has(i.type);
export const hasTask = (i) =>
  !!i && TASK_TYPES.has(i.type) && !!i.task && typeof i.task === "object";

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}
const plain = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const shortText = (value, max) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/u.test(value);

export function validTask(task) {
  if (!plain(task) || Object.keys(task).some((k) => !TASK_KEYS.includes(k)))
    return false;
  const { assignee, start, due, status, priority, jira } = task;
  if (
    assignee != null &&
    !(
      plain(assignee) &&
      Object.keys(assignee).every((k) => k === "id" || k === "name") &&
      shortText(assignee.id, 200) &&
      shortText(assignee.name, 120)
    )
  )
    return false;
  for (const date of [start, due])
    if (date != null && !validDate(date)) return false;
  if (start && due && start > due) return false;
  if (status !== undefined && !STATUSES.includes(status)) return false;
  if (priority !== undefined && !PRIORITIES.includes(priority)) return false;
  if (
    jira !== undefined &&
    !(
      plain(jira) &&
      Object.keys(jira).every((k) => ["key", "url", "status"].includes(k)) &&
      typeof jira.key === "string" &&
      JIRA_KEY.test(jira.key) &&
      jira.key.length <= 40 &&
      typeof jira.url === "string" &&
      jira.url.length <= 2000 &&
      /^https:\/\/[^\s]+$/.test(jira.url) &&
      (jira.status === undefined ||
        (typeof jira.status === "string" && jira.status.length <= 100))
    )
  )
    return false;
  return true;
}

// Called for every object by validateBoard.
export function validatePlanningFields(i) {
  if (i.task !== undefined && (!TASK_TYPES.has(i.type) || !validTask(i.task)))
    throw Error("Invalid task details.");
  if (
    i.dependency !== undefined &&
    (i.type !== "arrow" || !DEPENDENCIES.includes(i.dependency))
  )
    throw Error("Invalid task dependency.");
}

// Board-level planning settings.
export function validatePlanning(planning) {
  if (planning === undefined) return;
  if (
    !plain(planning) ||
    Object.keys(planning).some((k) => k !== "statusSync") ||
    (planning.statusSync !== undefined &&
      typeof planning.statusSync !== "boolean")
  )
    throw Error("Invalid planning settings.");
}

export function newTask(extra = {}) {
  return { assignee: null, start: null, due: null, status: "todo", ...extra };
}

// A copy of a task is a new task, so it drops a Jira link that a task on
// the board already has. A task that was cut and pasted keeps its link.
export function unlinkCopiedJira(copies, items = []) {
  const linked = new Set(
    items.filter((i) => hasTask(i) && i.task.jira).map((i) => i.task.jira.key),
  );
  for (const i of copies)
    if (hasTask(i) && linked.has(i.task.jira?.key)) {
      const { jira, ...task } = i.task;
      i.task = task;
    }
  return copies;
}

const fold = (value) =>
  String(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const STATUS_WORDS = {
  todo: [
    "to do",
    "todo",
    "backlog",
    "not started",
    "a faire",
    "carnet",
    "pas commence",
  ],
  "in-progress": [
    "in progress",
    "doing",
    "started",
    "en cours",
    "en progression",
  ],
  blocked: ["blocked", "on hold", "bloque", "bloquee", "bloques", "en attente"],
  done: [
    "done",
    "complete",
    "completed",
    "finished",
    "termine",
    "terminee",
    "termines",
    "terminees",
  ],
};
// Maps a status key, an English or French label, or a frame title to a
// status. Frame titles such as "Done (3)", "In progress (WIP 3)", or
// "À faire" also match: a count or note in parentheses is ignored.
export function statusFrom(value) {
  if (typeof value !== "string") return null;
  if (STATUSES.includes(value)) return value;
  const text = fold(value.replace(/\s*\([^()]*\)\s*$/, "")).replace(
    /\s*\d+$/,
    "",
  );
  if (!text) return null;
  for (const [status, words] of Object.entries(STATUS_WORDS))
    if (words.includes(text)) return status;
  return null;
}
export const statusFromTitle = statusFrom;

// Lenient reading for display and export.
export function readTask(i) {
  if (!hasTask(i)) return null;
  const task = i.task;
  const assignee =
    typeof task.assignee === "string" && task.assignee.trim()
      ? { id: `name:${task.assignee.trim()}`, name: task.assignee.trim() }
      : plain(task.assignee) && typeof task.assignee.name === "string"
        ? {
            id: String(task.assignee.id || task.assignee.name),
            ...task.assignee,
          }
        : null;
  return {
    assignee,
    start: validDate(task.start) ? task.start : null,
    due: validDate(task.due) ? task.due : null,
    status: statusFrom(task.status) || "todo",
    priority: PRIORITIES.includes(task.priority) ? task.priority : null,
    jira:
      plain(task.jira) && typeof task.jira.key === "string" ? task.jira : null,
  };
}

export function localDate(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const isOverdue = (task, today) =>
  !!task?.due && task.status !== "done" && task.due < today;

export function initials(name) {
  const words = String(name || "")
    .trim()
    .split(/[\s._@-]+/u)
    .filter(Boolean);
  const letters =
    words.length > 1
      ? [words[0], words.at(-1)].map((w) => Array.from(w)[0])
      : Array.from(words[0] || "?").slice(0, 2);
  return letters.join("").toLocaleUpperCase();
}
export const dayNumber = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
export const dateFromDay = (day) =>
  new Date(day * 86400000).toISOString().slice(0, 10);
// Creating a formatter is far slower than formatting, and task badges and
// lists format thousands of dates, so formatters are reused.
const formatters = new Map();
export function formatDate(date, lang = "en", options = {}) {
  if (!validDate(date)) return "";
  const [y, m, d] = date.split("-").map(Number);
  const key = lang + JSON.stringify(options);
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
      ...options,
    });
    if (formatters.size > 50) formatters.clear();
    formatters.set(key, format);
  }
  return format.format(new Date(Date.UTC(y, m - 1, d)));
}

// The compact task footer sits at the bottom of the object, below any tags.
// Plain text grows with its content, so its row has a fixed height.
export function taskRow(i) {
  if (!hasTask(i)) return 0;
  return i.type === "text" ? 26 : Math.min(26, Math.abs(i.h) * 0.28);
}

// Dependency edges between task objects, as predecessor -> successor pairs.
// Two lines saying the same thing are one dependency, and a line from a task
// back to itself is none.
export function dependencyEdges(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const edges = [],
    seen = new Set();
  for (const line of items) {
    if (line.type !== "arrow" || !line.dependency) continue;
    const a = byId.get(line.startId),
      b = byId.get(line.endId);
    if (!hasTask(a) || !hasTask(b) || a === b) continue;
    const edge =
      line.dependency === "blocks"
        ? { from: a.id, to: b.id, line: line.id }
        : { from: b.id, to: a.id, line: line.id };
    const key = JSON.stringify([edge.from, edge.to]);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(edge);
  }
  return withoutLoops(edges);
}
// Two people can each add a dependency that is fine alone but together make
// tasks wait on each other, so none could ever start. Edges are taken by
// line ID, the same on every device, and one that would close a loop is
// left out.
function withoutLoops(edges) {
  if (edges.length < 2) return edges;
  const next = new Map(),
    kept = new Set();
  const reaches = (start, goal) => {
    const seen = new Set([start]),
      queue = [start];
    while (queue.length)
      for (const id of next.get(queue.pop()) || []) {
        if (id === goal) return true;
        if (!seen.has(id)) (seen.add(id), queue.push(id));
      }
    return false;
  };
  for (const edge of [...edges].sort((a, b) =>
    a.line < b.line ? -1 : a.line > b.line ? 1 : 0,
  )) {
    if (edge.to === edge.from || reaches(edge.to, edge.from)) continue;
    if (!next.has(edge.from)) next.set(edge.from, []);
    next.get(edge.from).push(edge.to);
    kept.add(edge);
  }
  return kept.size === edges.length ? edges : edges.filter((e) => kept.has(e));
}
// Whether giving `line` the dependency `value` would make a task wait on
// itself through other tasks, so none of them could ever start.
export function dependencyCycle(items, line, value) {
  if (!value || !line?.startId || !line?.endId) return false;
  const [from, to] =
    value === "blocks"
      ? [line.startId, line.endId]
      : [line.endId, line.startId];
  const next = new Map();
  for (const edge of dependencyEdges(items.filter((i) => i.id !== line.id))) {
    if (!next.has(edge.from)) next.set(edge.from, []);
    next.get(edge.from).push(edge.to);
  }
  // Following dependencies on from `to` must not lead back to `from`.
  const seen = new Set([to]),
    queue = [to];
  while (queue.length)
    for (const id of next.get(queue.pop()) || []) {
      if (id === from) return true;
      if (!seen.has(id)) (seen.add(id), queue.push(id));
    }
  return false;
}
// Tasks whose predecessors are not done, with those predecessors.
export function blockers(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const result = new Map();
  for (const edge of dependencyEdges(items)) {
    const before = readTask(byId.get(edge.from));
    if (before.status === "done") continue;
    if (!result.has(edge.to)) result.set(edge.to, []);
    result.get(edge.to).push(byId.get(edge.from));
  }
  return result;
}
export const canBeDependency = (line, items) => {
  if (
    line?.type !== "arrow" ||
    !line.startId ||
    !line.endId ||
    line.startId === line.endId
  )
    return false;
  const a = items.find((i) => i.id === line.startId),
    b = items.find((i) => i.id === line.endId);
  return hasTask(a) && hasTask(b);
};

// Newly assigned people between two board snapshots: [{ item, assignee }].
export function assignmentChanges(before, after) {
  const old = new Map((before?.items || []).map((i) => [i.id, i]));
  const changes = [];
  for (const i of after?.items || []) {
    const next = hasTask(i) ? i.task.assignee : null;
    if (!next || typeof next !== "object" || !next.id) continue;
    const prior = old.get(i.id);
    const previous = hasTask(prior) ? prior.task.assignee : null;
    if (previous?.id === next.id) continue;
    changes.push({ item: i, assignee: next });
  }
  return changes;
}

// Shared document helpers: the board-level planning settings live in the
// board metadata map as one register.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function commitPlanning(meta, board) {
  const value = board.planning;
  if (value === undefined) {
    if (meta.has("planning")) meta.delete("planning");
  } else if (!same(meta.get("planning"), value))
    meta.set("planning", structuredClone(value));
}
export function readPlanning(meta) {
  const value = meta.get("planning");
  return plain(value) ? { planning: structuredClone(value) } : {};
}
export function rebasePlanning(local, before, remote) {
  const value = same(local.planning, before.planning)
    ? remote.planning
    : local.planning;
  return { planning: value === undefined ? undefined : structuredClone(value) };
}
