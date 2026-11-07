import { escape } from "../model.js";
import { language, plural, t, labelled } from "../i18n.js";
import { jiraLink } from "./jira.js";
import {
  STATUSES,
  STATUS_LABELS,
  PRIORITY_LABELS,
  formatDate,
  dateFromDay,
  dependencyEdges,
  localDate,
} from "./task.js";
import {
  collectTasks,
  filterTasks,
  sortTasks,
  groupTasks,
  summarizeTasks,
  exportTasksCSV,
  exportTasksXLSX,
} from "./tasks.js";
import { timelineModel } from "./timeline.js";
import { statusSyncEnabled } from "./kanban.js";
import { authoredTextHTML } from "../accessibility/object-content.js";
import { attachTaskPreview } from "./task-preview.js";

// Text glyphs repeat the status shape next to its name, so status never
// depends on color alone.
export const STATUS_GLYPHS = {
  todo: "○",
  "in-progress": "◐",
  blocked: "⊘",
  done: "✓",
};
const statusCell = (status) =>
  `<span class="task-status task-status-${status}"><span aria-hidden="true">${STATUS_GLYPHS[status]}</span> ${escape(t(STATUS_LABELS[status], "task"))}</span>`;
const date = (value) =>
  value
    ? `<time datetime="${value}">${escape(formatDate(value, language, { year: "numeric" }))}</time>`
    : "";
const taskTitleHTML = (row) =>
  row.titleGenerated
    ? escape(row.title)
    : authoredTextHTML({
        text: row.title,
        lang: row.titleLang,
        textRuns: row.titleRuns,
      });
const blockedHTML = (row) => row.blockedBy.map(taskTitleHTML).join(", ");
const frameHTML = (row) =>
  row.frameGenerated
    ? escape(row.frame)
    : authoredTextHTML({
        text: row.frame,
        lang: row.frameLang,
        textRuns: row.frameRuns,
      });
const groupLabelHTML = (group) =>
  group.labelGenerated
    ? escape(group.label)
    : authoredTextHTML({
        text: group.label,
        lang: group.labelLang,
        textRuns: group.labelRuns,
      });

// Each list group, and the timeline, shows this many tasks at first and
// this many more each time more are asked for.
const PAGE = 100;
const showingText = (shown, total) =>
  t("Showing {shown} of {total} tasks.")
    .replace("{shown}", shown)
    .replace("{total}", total);

// The Tasks dialog: a filtered, grouped task list with a summary, CSV/XLSX
// export, and a Gantt-style timeline with a table alternative.
export function openTasksDialog(api, { tab = "list" } = {}) {
  const board = api.board();
  if (!board) return;
  const state = {
    tab,
    status: "",
    assignee: "*",
    frame: "*",
    overdue: false,
    blocked: false,
    group: "status",
    sort: "due",
    lanes: "assignee",
    table: false,
  };
  let dialog,
    preview,
    peopleOpen = false,
    frameOpen = false,
    // How many tasks each list group, by its key, and the timeline show,
    // and the order of the tasks each was last drawn with.
    timelineLimit = PAGE,
    timelineOrder = [];
  const groupLimits = new Map(),
    groupOrder = new Map();
  const today = () => localDate(api.now());
  const view = () => api.view?.() ?? api.board();
  // The tasks are read once per draw, and shared by its parts.
  let drawn = null;
  const collect = () => collectTasks(view(), { today: today() });
  const rows = () => drawn ?? collect();
  // Exports hold what the open tab shows: the List's filters sit on the
  // List tab, and the Timeline shows every task.
  const shown = () =>
    state.tab === "timeline" ? sortTasks(rows(), state.sort) : visible();
  const visible = () =>
    sortTasks(
      filterTasks(rows(), {
        status: state.status,
        assignee: state.assignee,
        frame: state.frame,
        overdue: state.overdue,
        blocked: state.blocked,
      }),
      state.sort,
    );
  function summaryMarkup(all) {
    const s = summarizeTasks(all);
    return `<h3 class="sr-only">${t("Summary", "planning")}</h3><dl class="task-summary-counts"><div><dt>${t("Tasks")}</dt><dd>${s.total}</dd></div>${STATUSES.map((st) => `<div><dt>${statusCell(st)}</dt><dd>${s.byStatus[st]}</dd></div>`).join("")}<div><dt>${t("Overdue")}</dt><dd>${s.overdue}</dd></div><div><dt>${t("Blocked by other tasks")}</dt><dd>${s.blocked}</dd></div></dl><label class="task-progress">${t("Completion")} <strong>${s.completion}%</strong><progress max="100" value="${s.completion}">${s.completion}%</progress></label>${
      s.assignees.length
        ? `<details class="task-people"${peopleOpen ? " open" : ""}><summary id="tasks-people-toggle">${t("Tasks per assignee")}</summary><ul>${s.assignees.map((a) => `<li><span data-user-content>${escape(a.name)}</span>: ${a.total} (${plural(a.done, "{count} done", "{count} done")})</li>`).join("")}</ul></details>`
        : ""
    }`;
  }
  function filterMarkup(all) {
    const assignees = new Map(),
      frames = new Map();
    for (const r of all) {
      assignees.set(r.assigneeId, r.assigneeName || t("Unassigned"));
      frames.set(r.frameId, { ...r, frame: r.frame || t("No frame") });
    }
    const opt = (value, label, selected, user) =>
      `<option value="${escape(value)}" ${selected ? "selected" : ""}${user ? " data-user-content" : ""}>${escape(label)}</option>`;
    const frameChoices = [
      ["*", escape(t("All frames"))],
      ...[...frames].map(([id, row]) => [id, frameHTML(row)]),
    ];
    const frameFilter = `<div class="field"><span id="tasks-frame-label">${t("Frame")}</span><details id="tasks-frame" class="task-frame-filter"${frameOpen ? " open" : ""}><summary id="tasks-frame-toggle" aria-labelledby="tasks-frame-label tasks-frame-selected"><span id="tasks-frame-selected">${frameChoices.find(([id]) => id === state.frame)?.[1] || escape(t("All frames"))}</span></summary><fieldset class="frame-choices"><legend class="sr-only">${t("Frame")}</legend><div class="slide-choices">${frameChoices.map(([id, label]) => `<label><input type="radio" class="task-frame-choice" name="tasks-frame-choice" value="${escape(id)}"${state.frame === id ? " checked" : ""}><span>${label}</span></label>`).join("")}</div></fieldset></details></div>`;
    return `<div class="task-filters"><label class="field">${t("Status")}<select id="tasks-status">${opt("", t("All statuses"), !state.status)}${STATUSES.map((s) => opt(s, t(STATUS_LABELS[s], "task"), state.status === s)).join("")}</select></label><label class="field">${t("Assignee")}<select id="tasks-assignee">${opt("*", t("Everyone"), state.assignee === "*")}${[...assignees].map(([id, name]) => opt(id, name, state.assignee === id, !!id)).join("")}</select></label>${frameFilter}<label class="field">${t("Group by")}<select id="tasks-group">${[
      ["none", "No grouping"],
      ["status", "Status"],
      ["assignee", "Assignee"],
      ["frame", "Frame"],
    ]
      .map(([v, l]) => opt(v, t(l), state.group === v))
      .join(
        "",
      )}</select></label><label class="field">${t("Sort by")}<select id="tasks-sort">${[
      ["due", "Due date, earliest first"],
      ["due-desc", "Due date, latest first"],
      ["start", "Start date"],
      ["title", "Task name"],
    ]
      .map(([v, l]) => opt(v, t(l), state.sort === v))
      .join(
        "",
      )}</select></label><label class="check-field"><input type="checkbox" id="tasks-overdue" ${state.overdue ? "checked" : ""}><span>${t("Overdue only")}</span></label><label class="check-field"><input type="checkbox" id="tasks-blocked" ${state.blocked ? "checked" : ""}><span>${t("Blocked only")}</span></label></div>`;
  }
  function listMarkup(list) {
    if (!list.length)
      return `<p class="task-empty">${t(rows().length ? "No tasks match these filters." : "No tasks yet. Select sticky notes, shapes, or text and choose Task details, or add a task card.")}</p>`;
    groupOrder.clear();
    return groupTasks(list, state.group)
      .map((g, groupIndex) => {
        const key = `${state.group}:${g.key}`,
          limit = groupLimits.get(key) ?? PAGE;
        groupOrder.set(
          key,
          g.rows.map((r) => r.id),
        );
        return `<section class="task-group"><h3 id="task-group-heading-${groupIndex}">${state.group === "status" ? statusCell(g.key) : `<span ${g.key ? "data-user-content" : ""}>${state.group === "frame" ? groupLabelHTML(g) : escape(g.label)}</span>`} <span class="count">${g.rows.length}</span></h3><div class="task-table-wrap" data-task-table="${escape(`${state.group}:${g.key}`)}" tabindex="0" role="region" aria-labelledby="task-group-heading-${groupIndex}"><table class="task-table"><caption class="sr-only" ${state.group !== "status" && g.key ? "data-user-content" : ""}>${state.group === "frame" ? groupLabelHTML(g) : escape(g.label)}</caption><thead><tr>${[
          "Task",
          "Status",
          "Assignee",
          "Start",
          "Due",
          "Priority",
          "Frame",
          "Blocked by",
          "Jira",
        ]
          .map((h) => `<th scope="col">${t(h)}</th>`)
          .join("")}</tr></thead><tbody>${g.rows
          .slice(0, limit)
          .map(
            (r, rowIndex) =>
              `<tr><th scope="row"><button type="button" class="text-btn task-go" data-task="${escape(r.id)}" aria-labelledby="tasks-show-action task-list-title-${groupIndex}-${rowIndex}"><span id="task-list-title-${groupIndex}-${rowIndex}" data-user-content>${taskTitleHTML(r)}</span></button></th><td>${statusCell(r.status)}</td><td data-user-content>${escape(r.assigneeName)}</td><td>${date(r.start)}</td><td>${date(r.due)}${r.overdue ? ` <span class="task-overdue">${t("Overdue")}</span>` : ""}</td><td>${r.priority ? escape(t(PRIORITY_LABELS[r.priority])) : ""}</td><td data-user-content>${frameHTML(r)}</td><td data-user-content>${blockedHTML(r)}</td><td data-jira-task="${escape(r.id)}">${r.jira ? `${jiraLink(r.jira)}${r.jira.status ? ` <span data-user-content>${escape(r.jira.status)}</span>` : ""}` : ""}</td></tr>`,
          )
          .join("")}</tbody></table></div>${
          g.rows.length > limit
            ? `<p class="task-help" id="task-group-shown-${groupIndex}">${showingText(limit, g.rows.length)}</p><button type="button" class="secondary" data-task-more="${escape(key)}" aria-describedby="task-group-shown-${groupIndex}">${t("Show more tasks")}</button>`
            : ""
        }</section>`;
      })
      .join("");
  }
  function timelineMarkup(list) {
    const model = timelineModel(list, {
      groupBy: state.lanes,
      today: today(),
      edges: dependencyEdges(view().items),
    });
    const controls = `<div class="task-filters"><label class="field">${t("Lanes")}<select id="timeline-lanes">${[
      ["assignee", "Assignee"],
      ["frame", "Frame"],
      ["status", "Status"],
    ]
      .map(
        ([v, l]) =>
          `<option value="${v}" ${state.lanes === v ? "selected" : ""}>${t(l)}</option>`,
      )
      .join(
        "",
      )}</select></label><button type="button" class="secondary" id="timeline-table" aria-pressed="${state.table}">${t("Show as table")}</button><button type="button" class="secondary" id="timeline-place" ${model.lanes.length && (api.canPlan ?? api.canAdd)() ? "" : "disabled"}>${t("Place on board as timeline")}</button></div>`;
    const unscheduled = model.unscheduled.length
      ? `<p class="task-help">${model.unscheduled.length} ${t(model.unscheduled.length === 1 ? "task has no dates and is not shown." : "tasks have no dates and are not shown.")}</p>`
      : "";
    if (!model.lanes.length)
      return `${controls}<p class="task-empty">${t("Add start or due dates to tasks to see them on the timeline.")}</p>${unscheduled}`;
    // The first tasks in lane order are drawn, with the rest a page at a
    // time; the dates along the top still span every task.
    timelineOrder = model.lanes.flatMap((lane) =>
      lane.bars.map((b) => b.row.id),
    );
    let room = timelineLimit;
    const shownLanes = model.lanes
      .map((lane) => {
        const bars = lane.bars.slice(0, Math.max(0, room));
        room -= bars.length;
        return { ...lane, bars };
      })
      .filter((lane) => lane.bars.length);
    const more =
      timelineOrder.length > timelineLimit
        ? `<p class="task-help" id="timeline-shown">${showingText(timelineLimit, timelineOrder.length)}</p><button type="button" class="secondary" id="timeline-more" aria-describedby="timeline-shown">${t("Show more tasks")}</button>`
        : "";
    const range = (b) =>
      `${formatDate(dateFromDay(b.start), language, { year: "numeric" })} ${t("to")} ${formatDate(dateFromDay(b.end), language, { year: "numeric" })}`;
    if (state.table)
      return `${controls}<div class="task-table-wrap" data-task-table="timeline" tabindex="0" role="region" aria-labelledby="timeline-caption"><table class="task-table" id="timeline-data"><caption id="timeline-caption">${t("Timeline")}</caption><thead><tr>${[
        "Task",
        "Lane",
        "Start",
        "Due",
        "Days",
        "Status",
        "Blocked by",
      ]
        .map((h) => `<th scope="col">${t(h)}</th>`)
        .join("")}</tr></thead><tbody>${shownLanes
        .flatMap((lane) =>
          lane.bars.map(
            (b) =>
              `<tr><th scope="row"><button type="button" class="text-btn task-go" data-task="${escape(b.row.id)}"><span data-user-content>${taskTitleHTML(b.row)}</span></button></th><td data-user-content>${state.lanes === "frame" ? groupLabelHTML(lane) : escape(lane.label)}</td><td>${date(b.row.start)}</td><td>${date(b.row.due)}</td><td>${b.end - b.start + 1}</td><td>${statusCell(b.row.status)}</td><td data-user-content>${blockedHTML(b.row)}</td></tr>`,
          ),
        )
        .join("")}</tbody></table></div>${more}${unscheduled}`;
    const ROW = 34,
      PAD = 6;
    let top = 0;
    const tops = new Map();
    const lanes = shownLanes
      .map((lane, index) => {
        const height = lane.bars.length * ROW + PAD * 2;
        const bars = lane.bars
          .map((b, n) => {
            tops.set(b.row.id, {
              y: top + PAD + n * ROW + ROW / 2,
              left: b.left,
              right: b.left + b.width,
            });
            const blocked = b.row.blockedBy.length
              ? `. ${escape(t("Blocked by"))}: ${blockedHTML(b.row)}`
              : "";
            // Named by a hidden element kept as written, so translating
            // the interface never rewrites the start of a task's title.
            const name = `timeline-bar-${index}-${n}`;
            return `<button type="button" class="timeline-bar task-status-${b.row.status}" data-task="${escape(b.row.id)}" data-user-content tabindex="-1" style="left:${b.left.toFixed(3)}%;width:${b.width.toFixed(3)}%;top:${PAD + n * ROW}px" aria-labelledby="${name}" aria-controls="tasks-title-preview"><span aria-hidden="true">${STATUS_GLYPHS[b.row.status]}</span> <span>${taskTitleHTML(b.row)}</span><span class="sr-only" id="${name}">${taskTitleHTML(b.row)}${escape(`, ${t(STATUS_LABELS[b.row.status], "task")}, ${range(b)}${b.row.assigneeName ? `, ${labelled(t("Assignee"), "")}${b.row.assigneeName}` : ""}`)}${blocked}</span><span hidden data-task-preview>${taskTitleHTML(b.row)} (${escape(range(b))})</span></button>`;
          })
          .join("");
        top += height;
        // Named by its label element, which keeps people's names as written.
        return `<div class="timeline-lane" role="group" aria-labelledby="timeline-lane-${index}"><div class="timeline-lane-label" id="timeline-lane-${index}" data-user-content>${state.lanes === "frame" ? groupLabelHTML(lane) : escape(lane.label)}</div><div class="timeline-track" style="height:${height}px">${model.today !== null ? `<span class="timeline-today-line" style="left:${model.today.toFixed(3)}%"></span>` : ""}${bars}</div></div>`;
      })
      .join("");
    const deps = model.edges
      .map((e) => {
        const a = tops.get(e.from),
          b = tops.get(e.to);
        if (!a || !b) return "";
        const x1 = a.right * 10,
          x2 = b.left * 10;
        return `<g data-from="${escape(e.from)}" data-to="${escape(e.to)}">${dependencyLine(x1, a.y, x2, b.y)}</g>`;
      })
      .join("");
    const scale = model.ticks
      .map(
        (tick) =>
          `<span style="left:${model.percent(tick.day).toFixed(3)}%">${escape(tick.label)}</span>`,
      )
      .join("");
    return `${controls}<p id="timeline-help" class="task-help">${t("Use the arrow keys to move between bars. Press Enter to show a task on the board.")}${model.edges.length ? ` ${t("Lines connect tasks to the tasks they block.")}` : ""}</p><div class="timeline" role="group" aria-label="${escape(t("Timeline chart"))}" aria-describedby="timeline-help"><div class="timeline-lane timeline-header" aria-hidden="true"><div class="timeline-lane-label"></div><div class="timeline-scale">${scale}${model.today !== null ? `<span class="timeline-today-label" style="left:${model.today.toFixed(3)}%">${t("Today")}</span>` : ""}</div></div><div class="timeline-body">${lanes}${deps ? `<svg class="timeline-deps" viewBox="0 0 1000 ${top}" preserveAspectRatio="none" style="height:${top}px" aria-hidden="true" focusable="false">${deps}</svg>` : ""}</div></div>${more}${unscheduled}`;
  }
  function dependencyLine(x1, y1, x2, y2) {
    const mx = Math.max(x1 + 8, (x1 + x2) / 2);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}H${mx.toFixed(1)}V${y2.toFixed(1)}H${x2.toFixed(1)}"/><circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="3"/>`;
  }
  // Lines are first placed from the lanes' planned heights. Lane borders
  // and lane labels that wrap make lanes taller, so once the chart is laid
  // out they are drawn again between the bars where they are.
  function alignDependencies() {
    const svg = dialog.querySelector(".timeline-deps"),
      body = svg?.parentElement;
    if (!svg || body.closest("[hidden]")) return;
    const box = svg.getBoundingClientRect(),
      height = body.getBoundingClientRect().height;
    if (!box.width || !height) return;
    svg.style.height = `${height}px`;
    svg.setAttribute("viewBox", `0 0 1000 ${height}`);
    const bars = new Map(
      [...body.querySelectorAll(".timeline-bar")].map((b) => [
        b.dataset.task,
        b.getBoundingClientRect(),
      ]),
    );
    const x = (value) => ((value - box.left) / box.width) * 1000;
    for (const g of svg.querySelectorAll("g[data-from]")) {
      const a = bars.get(g.dataset.from),
        b = bars.get(g.dataset.to);
      if (a && b)
        g.innerHTML = dependencyLine(
          x(a.right),
          a.top + a.height / 2 - box.top,
          x(b.left),
          b.top + b.height / 2 - box.top,
        );
    }
  }
  function jiraMarkup(all) {
    const linked = all.filter((r) => r.jira).length;
    const status = api.jira.status();
    return `<div class="task-jira"><p class="task-help">${escape(t(status.message))}</p>${status.available ? `<button type="button" class="secondary" id="tasks-jira-send" ${api.selectedTasks().length && api.canAdd() ? "" : "disabled"}>${t("Send selected tasks to Jira")}</button><button type="button" class="secondary" id="tasks-jira-refresh" ${linked ? "" : "disabled"}>${t("Refresh Jira status")}</button>` : ""}</div>`;
  }
  function render(focusSelector, all = collect()) {
    drawn = all;
    try {
      draw(focusSelector);
    } finally {
      drawn = null;
    }
  }
  function draw(focusSelector) {
    if (!dialog?.isConnected) return;
    if (api.board() !== board) return dialog.close();
    const all = rows();
    // A filter whose person or frame no longer has tasks shows everything,
    // matching its select, instead of an unexplained empty list.
    if (
      state.assignee !== "*" &&
      !all.some((r) => r.assigneeId === state.assignee)
    )
      state.assignee = "*";
    if (state.frame !== "*" && !all.some((r) => r.frameId === state.frame))
      state.frame = "*";
    const list = visible();
    // Focus returns to the same control, including task rows and bars.
    const focused = dialog.contains(document.activeElement)
      ? document.activeElement
      : null;
    const task = focused?.dataset.task?.replace(/["\\]/g, "\\$&");
    const frameChoice = focused?.matches(".task-frame-choice")
      ? `.task-frame-choice[value="${focused.value.replace(/["\\]/g, "\\$&")}"]`
      : null;
    const tableFocus = focused?.matches(".task-table-wrap[data-task-table]")
      ? `.task-table-wrap[data-task-table="${focused.dataset.taskTable.replace(/["\\]/g, "\\$&")}"]`
      : null;
    const moreFocus = focused?.matches("[data-task-more]")
      ? `[data-task-more="${focused.dataset.taskMore.replace(/["\\]/g, "\\$&")}"]`
      : null;
    // A task's Jira link, which has no id of its own.
    const jiraCell =
      focused?.matches("a") && focused.closest("[data-jira-task]");
    const jiraFocus = jiraCell
      ? `[data-jira-task="${jiraCell.dataset.jiraTask.replace(/["\\]/g, "\\$&")}"] a`
      : null;
    const active =
      focusSelector ||
      frameChoice ||
      tableFocus ||
      moreFocus ||
      jiraFocus ||
      (focused?.id
        ? `#${focused.id}`
        : task !== undefined && focused.matches(".task-go, .timeline-bar")
          ? `${focused.matches(".timeline-bar") ? ".timeline-bar" : ".task-go"}[data-task="${task}"]`
          : null);
    // The assignee breakdown stays open while someone reads it.
    peopleOpen = !!dialog.querySelector(".task-people")?.open;
    frameOpen = !!dialog.querySelector("#tasks-frame")?.open;
    const frameScroll =
      dialog.querySelector(".task-frame-filter .slide-choices")?.scrollTop || 0;
    const tableScroll = new Map(
      [...dialog.querySelectorAll(".task-table-wrap[data-task-table]")].map(
        (table) => [table.dataset.taskTable, table.scrollLeft],
      ),
    );
    dialog.querySelector("#tasks-summary").innerHTML = summaryMarkup(all);
    dialog.querySelector("#tasks-controls").innerHTML = filterMarkup(all);
    dialog.querySelector(".task-frame-filter .slide-choices").scrollTop =
      frameScroll;
    // Only the open tab is built; switching tabs renders the other one.
    // The list's filters sit on the List tab, so the timeline shows every
    // dated task.
    if (state.tab === "list")
      dialog.querySelector("#tasks-list").innerHTML = listMarkup(list);
    else
      dialog.querySelector("#tasks-timeline").innerHTML = timelineMarkup(all);
    for (const table of dialog.querySelectorAll(
      ".task-table-wrap[data-task-table]",
    ))
      table.scrollLeft = tableScroll.get(table.dataset.taskTable) || 0;
    dialog.querySelector("#tasks-jira").innerHTML = jiraMarkup(all);
    dialog.querySelector("#tasks-sync").checked = statusSyncEnabled(
      api.board(),
    );
    dialog.querySelector("#tasks-sync").disabled = !(
      api.canPlan ?? api.canAdd
    )();
    for (const name of ["list", "timeline"]) {
      const selected = state.tab === name;
      const tabButton = dialog.querySelector(`#tasks-tab-${name}`);
      tabButton.setAttribute("aria-selected", String(selected));
      tabButton.tabIndex = selected ? 0 : -1;
      dialog.querySelector(
        name === "list" ? "#tasks-list-panel" : "#tasks-timeline",
      ).hidden = !selected;
    }
    if (state.tab === "timeline") alignDependencies();
    const first = dialog.querySelector(".timeline-bar");
    const bar =
      (active && dialog.querySelector(active)?.closest(".timeline-bar")) ||
      first;
    if (bar) bar.tabIndex = 0;
    preview.refresh();
    dialog.querySelector("#tasks-count").textContent = plural(
      list.length,
      "{count} task shown",
      "{count} tasks shown",
    );
    // A focused row or bar that is gone, as when someone else removed its
    // task, or a control disabled because the board was locked, gives focus
    // to the current tab rather than the page.
    if (active) {
      const candidate = dialog.querySelector(active);
      const target =
        candidate &&
        !candidate.matches(":disabled") &&
        !candidate.closest("[hidden]")
          ? candidate
          : dialog.querySelector(`#tasks-tab-${state.tab}`);
      target?.focus({ preventScroll: !target.matches(".task-frame-choice") });
    }
  }
  // Refusals and Jira results stay in the dialog until the next action,
  // rather than in a notification that fades; false once it has closed.
  function report(message) {
    if (!dialog?.isConnected) return false;
    dialog.querySelector("#tasks-feedback").textContent = message
      ? t(message)
      : "";
    return true;
  }
  function bind() {
    dialog.addEventListener("change", (e) => {
      const el = e.target;
      const map = {
        "tasks-status": "status",
        "tasks-assignee": "assignee",
        "tasks-group": "group",
        "tasks-sort": "sort",
        "timeline-lanes": "lanes",
      };
      if (el.matches(".task-frame-choice")) state.frame = el.value;
      else if (map[el.id]) state[map[el.id]] = el.value;
      else if (el.id === "tasks-overdue") state.overdue = el.checked;
      else if (el.id === "tasks-blocked") state.blocked = el.checked;
      else if (el.id === "tasks-sync") {
        api.setStatusSync(el.checked);
      } else return;
      render(
        el.matches(".task-frame-choice")
          ? `.task-frame-choice[value="${el.value.replace(/["\\]/g, "\\$&")}"]`
          : `#${el.id}`,
      );
    });
    dialog.addEventListener("click", async (e) => {
      const el = e.target.closest("button,a");
      if (!el) return;
      if (el.matches(".task-go, .timeline-bar")) {
        dialog.close();
        api.focusObject(el.dataset.task);
      } else if (el.matches("[data-task-more]")) {
        // The keyboard moves on to the first task added.
        const key = el.dataset.taskMore,
          shown = groupLimits.get(key) ?? PAGE,
          id = groupOrder.get(key)?.[shown];
        groupLimits.set(key, shown + PAGE);
        render(
          id === undefined
            ? undefined
            : `#tasks-list .task-go[data-task="${id.replace(/["\\]/g, "\\$&")}"]`,
        );
      } else if (el.id === "timeline-more") {
        const id = timelineOrder[timelineLimit];
        timelineLimit += PAGE;
        render(
          id === undefined
            ? undefined
            : `#tasks-timeline ${state.table ? ".task-go" : ".timeline-bar"}[data-task="${id.replace(/["\\]/g, "\\$&")}"]`,
        );
      } else if (el.id === "timeline-table") {
        state.table = !state.table;
        render("#timeline-table");
      } else if (el.id === "timeline-place") {
        report("");
        if (api.placeTimeline(rows(), state.lanes, report)) dialog.close();
      } else if (el.id === "tasks-csv")
        api.download(exportTasksCSV(shown()), "csv");
      else if (el.id === "tasks-xlsx")
        api.download(exportTasksXLSX(shown(), api.board().title), "xlsx");
      else if (el.id === "tasks-jira-send" || el.id === "tasks-jira-refresh") {
        el.disabled = true;
        report("");
        if (el.id === "tasks-jira-send")
          await api.jira.send(api.selectedTasks(), report);
        else await api.jira.refresh(report);
        // Turned off while it worked, the button lost focus; it gets it back
        // unless the person moved elsewhere meanwhile.
        const lost = [el, document.body, null].includes(document.activeElement);
        render(lost ? `#${el.id}` : undefined);
      } else if (el.matches("[role=tab]")) {
        state.tab = el.id === "tasks-tab-timeline" ? "timeline" : "list";
        render(
          el.matches(".task-frame-choice")
            ? `.task-frame-choice[value="${el.value.replace(/["\\]/g, "\\$&")}"]`
            : `#${el.id}`,
        );
      }
    });
    dialog.addEventListener("keydown", (e) => {
      const scrolling = e.target;
      if (
        scrolling.matches?.(".task-table-wrap[data-task-table]") &&
        !e.defaultPrevented &&
        !e.isComposing &&
        e.keyCode !== 229 &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        ["ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        const maximum = scrolling.scrollWidth - scrolling.clientWidth;
        if (maximum > 0) {
          e.preventDefault();
          scrolling.scrollLeft = Math.max(
            0,
            Math.min(
              maximum,
              scrolling.scrollLeft + (e.key === "ArrowRight" ? 48 : -48),
            ),
          );
        }
        return;
      }
      const tabButton = e.target.closest?.("[role=tab]");
      if (
        tabButton &&
        ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
      ) {
        e.preventDefault();
        state.tab = state.tab === "list" ? "timeline" : "list";
        if (e.key === "Home") state.tab = "list";
        if (e.key === "End") state.tab = "timeline";
        render(`#tasks-tab-${state.tab}`);
        return;
      }
      const bar = e.target.closest?.(".timeline-bar");
      if (!bar) return;
      const bars = [...dialog.querySelectorAll(".timeline-bar")],
        n = bars.indexOf(bar);
      const next = {
        ArrowRight: n + 1,
        ArrowDown: n + 1,
        ArrowLeft: n - 1,
        ArrowUp: n - 1,
        Home: 0,
        End: bars.length - 1,
      }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      const target = bars[Math.max(0, Math.min(bars.length - 1, next))];
      bars.forEach((b) => (b.tabIndex = b === target ? 0 : -1));
      target.focus();
    });
  }
  dialog = api.modal(
    t("Tasks"),
    `<div class="tasks-dialog"><span class="sr-only" id="tasks-show-action">${escape(t("Show on board"))}:</span><section id="tasks-summary" class="task-summary" aria-label="${escape(t("Summary", "planning"))}"></section><div role="tablist" class="task-tabs" aria-label="${escape(t("Planning views"))}"><button type="button" role="tab" id="tasks-tab-list" aria-controls="tasks-list-panel">${t("List")}</button><button type="button" role="tab" id="tasks-tab-timeline" aria-controls="tasks-timeline">${t("Timeline")}</button></div><div id="tasks-list-panel" role="tabpanel" aria-labelledby="tasks-tab-list"><div id="tasks-controls"></div><p id="tasks-count" class="task-help" role="status"></p><div id="tasks-list"></div></div><div id="tasks-timeline" role="tabpanel" aria-labelledby="tasks-tab-timeline" hidden></div><div class="task-footer"><label class="check-field"><input type="checkbox" id="tasks-sync"><span>${t("Update task status when a task moves into a frame named after a status (Kanban)")}</span></label><div id="tasks-jira"></div><p id="tasks-feedback" class="task-help" role="status"></p><div class="dialog-footer"><button type="button" class="secondary" id="tasks-csv">${t("Export CSV")}</button><button type="button" class="primary" id="tasks-xlsx">${t("Export Excel")}</button></div></div></div>`,
    (d) => {
      dialog = d;
      d.classList.add("tasks-modal");
      bind();
    },
  );
  preview = attachTaskPreview(dialog);
  // Board changes while the dialog is open refresh it only when the tasks,
  // settings, or selection differ, so keyboard focus stays in place.
  const signature = (all) =>
    JSON.stringify([
      all.map(({ item, ...row }) => row),
      // The timeline draws every dependency, including ones on finished
      // tasks, which change no row.
      dependencyEdges(view().items),
      statusSyncEnabled(api.board()),
      api.jira.status(),
      api.selectedTasks().map((i) => i.id),
      api.canAdd(),
      (api.canPlan ?? api.canAdd)(),
    ]);
  let rendered = signature(collect());
  render();
  dialog.querySelector(`#tasks-tab-${state.tab}`)?.focus();
  return {
    dialog,
    refresh() {
      const all = collect(),
        next = signature(all);
      if (next === rendered) return;
      rendered = next;
      render(undefined, all);
    },
  };
}
