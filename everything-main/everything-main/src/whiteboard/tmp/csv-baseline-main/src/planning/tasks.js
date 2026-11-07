import "./i18n.js";
import { t } from "../i18n.js";
import { capturedTaskTitle } from "./task-title.js";
import { canonicalLanguage } from "../accessibility/language-tag.js";
import { appendRun } from "../rich-text.js";
import { buildXLSX, toCSV } from "../export-sheet.js";
import {
  STATUSES,
  STATUS_LABELS,
  PRIORITY_LABELS,
  readTask,
  hasTask,
  isOverdue,
  blockers,
  localDate,
} from "./task.js";

export const UNASSIGNED = "";
export const NO_FRAME = "";
const title = (i) => {
  const content = capturedTaskTitle(i, Infinity);
  if (content.titleGenerated) content.title = t("Untitled task");
  return content;
};
const frameMetadata = (frame) => {
  if (frame?.type !== "frame" || !frame.text) return { frameGenerated: true };
  const lang = canonicalLanguage(frame.lang),
    runs = [];
  for (const run of frame.textRuns || []) {
    const tag = canonicalLanguage(run.style.lang);
    if (tag) appendRun(runs, run.start, run.end, { lang: tag });
  }
  return {
    frameGenerated: false,
    ...(lang ? { frameLang: lang } : {}),
    ...(runs.length ? { frameRuns: runs } : {}),
  };
};

// One row per task object, in board order.
export function collectTasks(board, { today = localDate() } = {}) {
  const items = board?.items || [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const blocked = blockers(items);
  return items.filter(hasTask).map((i) => {
    const task = readTask(i);
    const frame = byId.get(i.parentId);
    return {
      id: i.id,
      item: i,
      ...title(i),
      ...task,
      assigneeId: task.assignee?.id || UNASSIGNED,
      assigneeName: task.assignee?.name || "",
      frameId: frame?.type === "frame" ? frame.id : NO_FRAME,
      frame: frame?.type === "frame" ? frame.text || t("Frame") : "",
      ...frameMetadata(frame),
      overdue: isOverdue(task, today),
      blockedBy: (blocked.get(i.id) || []).map((b) => ({
        id: b.id,
        ...title(b),
      })),
    };
  });
}

export function filterTasks(rows, filters = {}) {
  return rows.filter(
    (r) =>
      (!filters.status || r.status === filters.status) &&
      (filters.assignee === undefined ||
        filters.assignee === null ||
        filters.assignee === "*" ||
        r.assigneeId === filters.assignee) &&
      (!filters.overdue || r.overdue) &&
      (!filters.blocked || r.blockedBy.length > 0) &&
      (filters.frame === undefined ||
        filters.frame === null ||
        filters.frame === "*" ||
        r.frameId === filters.frame),
  );
}

// Undated tasks sort last in either direction.
export function sortTasks(rows, sort = "due") {
  const key = sort.startsWith("start") ? "start" : "due",
    direction = sort.endsWith("-desc") ? -1 : 1;
  if (sort === "title")
    return [...rows].sort((a, b) => a.title.localeCompare(b.title));
  return [...rows].sort((a, b) =>
    a[key] && b[key]
      ? (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * direction ||
        a.title.localeCompare(b.title)
      : a[key]
        ? -1
        : b[key]
          ? 1
          : a.title.localeCompare(b.title),
  );
}

// Groups keep a stable order: statuses in workflow order, assignees and
// frames alphabetically with the unassigned or frameless group last.
export function groupTasks(rows, by = "none") {
  if (by === "none") return [{ key: "*", label: t("All tasks"), rows }];
  const groups = new Map();
  const add = (key, label, row) => {
    if (!groups.has(key)) groups.set(key, { key, label, rows: [] });
    groups.get(key).rows.push(row);
  };
  for (const r of rows) {
    if (by === "status") add(r.status, t(STATUS_LABELS[r.status], "task"), r);
    else if (by === "assignee")
      add(r.assigneeId, r.assigneeName || t("Unassigned"), r);
    else {
      add(r.frameId, r.frame || t("No frame"), r);
      const group = groups.get(r.frameId);
      group.labelGenerated = r.frameGenerated;
      group.labelLang = r.frameLang;
      group.labelRuns = r.frameRuns;
    }
  }
  const list = [...groups.values()];
  if (by === "status")
    return list.sort(
      (a, b) => STATUSES.indexOf(a.key) - STATUSES.indexOf(b.key),
    );
  return list.sort((a, b) =>
    a.key === "" ? 1 : b.key === "" ? -1 : a.label.localeCompare(b.label),
  );
}

export function summarizeTasks(rows) {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const people = new Map();
  let overdue = 0,
    blocked = 0;
  for (const r of rows) {
    byStatus[r.status]++;
    if (r.overdue) overdue++;
    if (r.blockedBy.length) blocked++;
    const key = r.assigneeId;
    if (!people.has(key))
      people.set(key, {
        id: key,
        name: r.assigneeName || t("Unassigned"),
        total: 0,
        done: 0,
      });
    const person = people.get(key);
    person.total++;
    if (r.status === "done") person.done++;
  }
  return {
    total: rows.length,
    byStatus,
    overdue,
    blocked,
    // 100% only when every task is done, and 0% only when none is.
    completion: rows.length
      ? Math.min(
          byStatus.done < rows.length ? 99 : 100,
          Math.max(
            byStatus.done ? 1 : 0,
            Math.round((byStatus.done / rows.length) * 100),
          ),
        )
      : 0,
    assignees: [...people.values()].sort((a, b) =>
      a.id === "" ? 1 : b.id === "" ? -1 : a.name.localeCompare(b.name),
    ),
  };
}

// The task list as one spreadsheet sheet, shared by CSV and XLSX.
export function taskSheet(rows) {
  return {
    key: "tasks",
    name: t("Tasks"),
    filter: true,
    rows: [
      [
        "Task",
        "Status",
        "Assignee",
        "Start",
        "Due",
        "Priority",
        "Frame",
        "Blocked by",
        "Overdue",
        "Jira",
        "Jira status",
        "ID",
      ].map(t),
      ...rows.map((r) => [
        r.title,
        t(STATUS_LABELS[r.status], "task"),
        r.assigneeName,
        r.start || "",
        r.due || "",
        r.priority ? t(PRIORITY_LABELS[r.priority]) : "",
        r.frame,
        r.blockedBy.map((b) => b.title).join(", "),
        r.overdue ? t("Yes") : "",
        r.jira?.key || "",
        r.jira?.status || "",
        r.id,
      ]),
    ],
  };
}
export function summarySheet(summary) {
  return {
    key: "summary",
    name: t("Summary"),
    filter: false,
    rows: [
      [t("Measure"), t("Value")],
      [t("Tasks"), summary.total],
      ...STATUSES.map((s) => [
        t(STATUS_LABELS[s], "task"),
        summary.byStatus[s],
      ]),
      [t("Overdue"), summary.overdue],
      [t("Blocked by other tasks"), summary.blocked],
      [t("Completion (%)"), summary.completion],
      ...summary.assignees.map((a) => [`${t("Assigned")}: ${a.name}`, a.total]),
    ],
  };
}
export function exportTasksCSV(rows) {
  return new Blob([toCSV(taskSheet(rows).rows)], {
    type: "text/csv;charset=utf-8",
  });
}
export function exportTasksXLSX(rows, boardTitle = "") {
  return new Blob(
    [
      buildXLSX([taskSheet(rows), summarySheet(summarizeTasks(rows))], {
        title: boardTitle,
      }),
    ],
    {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  );
}
