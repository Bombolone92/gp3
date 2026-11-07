import { escape } from "../model.js";
import { plural, t } from "../i18n.js";
import { jiraLink } from "./jira.js";
import {
  STATUSES,
  STATUS_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  taskable,
  hasTask,
  newTask,
  validTask,
  validDate,
} from "./task.js";

const MIXED = "__mixed__";
const same = (values) =>
  values.every((v) => JSON.stringify(v) === JSON.stringify(values[0]))
    ? values[0]
    : MIXED;
export const assigneeFromName = (name) => {
  const value = name.replace(/\s+/g, " ").trim().slice(0, 120);
  return value
    ? { id: `name:${value.toLocaleLowerCase()}`, name: value }
    : null;
};

// Task details for the selected objects, in a side panel like Tags. Every
// change is one undoable edit applied to each selected task.
export function createTaskPanel(api) {
  let panel, board, ids, signature, people, opener, stale;
  // The value each text or date field last showed. A field being typed in
  // keeps its text; a value that changed meanwhile shows once focus leaves.
  const shown = new WeakMap();
  function fill(input, value) {
    if (document.activeElement !== input) {
      input.value = value;
      shown.set(input, value);
    } else if (shown.get(input) !== value) stale = true;
  }
  const selected = () => board.items.filter((i) => ids.has(i.id));
  // Selected objects that can hold tasks, apart from content hidden from
  // this person, such as another participant's private note.
  const targets = () => {
    const selection = api.selection(),
      hidden = api.concealed?.() ?? new Set();
    return board.items.filter(
      (i) => selection.has(i.id) && taskable(i) && !hidden.has(i.id),
    );
  };
  const writable = () => api.canEdit(ids);
  function close(focus = false) {
    panel?.remove();
    panel = null;
    signature = null;
    if (!focus) return;
    // Focus returns to the control that opened the panel, found again by id
    // when the selection toolbar has redrawn it, and otherwise the canvas.
    const back = opener?.isConnected
      ? opener
      : opener?.id && document.getElementById(opener.id);
    if (back && !back.disabled && !back.closest("[hidden]")) back.focus();
    else api.canvas()?.focus();
  }
  function error(message) {
    const out = panel?.querySelector("#task-error");
    if (!out) return api.toast(message);
    out.hidden = !message;
    out.textContent = message ? t(message) : "";
  }
  function change(fn, message = "") {
    if (api.board() !== board || !writable())
      return error(
        api.readOnly()
          ? "This board is read-only."
          : "This selection is protected.",
      );
    const items = selected();
    const next = items.map((i) => {
      const task = fn(i.task ? { ...i.task } : null, i);
      return task === undefined ? i.task : task;
    });
    // Date fields report a year of up to six digits, and year 0026 when
    // two digits are typed; tasks keep years from 100 to 9999.
    if (
      next.some(
        (task) =>
          task && [task.start, task.due].some((d) => d && !validDate(d)),
      )
    )
      return error("Enter a valid date, with a year from 100 to 9999.");
    if (next.some((task) => task && !validTask(task)))
      return error("The start date must be on or before the due date.");
    if (
      items.every((i, n) => JSON.stringify(i.task) === JSON.stringify(next[n]))
    )
      return error("");
    error("");
    api.mutate(() =>
      items.forEach((i, n) => {
        if (next[n]) i.task = next[n];
        else delete i.task;
      }),
    );
    if (message) api.announce(message);
  }
  const setField = (key, value) =>
    change((task) => {
      if (!task) return undefined;
      if (value === null && (key === "priority" || key === "jira"))
        delete task[key];
      else task[key] = value;
      return task;
    });
  const listOptions = (list, value, mixed) =>
    list
      .map(
        ([v, label, user]) =>
          `<option value="${escape(v)}" ${!mixed && v === value ? "selected" : ""}${user ? " data-user-content" : ""}>${escape(label)}</option>`,
      )
      .join("");
  function options(select, list, value, mixed) {
    select.innerHTML =
      (mixed
        ? `<option value="${MIXED}" disabled selected>${t("Mixed")}</option>`
        : "") + listOptions(list, value, mixed);
  }
  function keepFocus(focused) {
    if (
      focused &&
      (focused.disabled || focused.closest("[hidden]")) &&
      (document.activeElement === focused ||
        document.activeElement === document.body)
    ) {
      const make = panel.querySelector("#task-make");
      (!make.hidden && !make.disabled
        ? make
        : panel.querySelector("#task-close")
      ).focus({ preventScroll: true });
    }
  }
  function render() {
    if (!panel) return;
    if (
      api.board() !== board ||
      targets()
        .map((i) => i.id)
        .sort()
        .join() !== [...ids].sort().join()
    )
      // Focus inside it returns to where the panel was opened from.
      return close(panel.contains(document.activeElement));
    const items = selected(),
      tasks = items.filter(hasTask),
      canWrite = writable();
    const key = JSON.stringify([
      items.map((i) => [i.id, i.task, i.text]),
      canWrite,
      people,
    ]);
    if (key === signature) return;
    signature = key;
    const q = (s) => panel.querySelector(s);
    q("#task-summary").textContent =
      `${plural(items.length, "{count} selected object", "{count} selected objects")} · ${plural(tasks.length, "{count} task", "{count} tasks")}`;
    // A button that hides itself hands keyboard focus to what replaces it.
    const focused = panel.contains(document.activeElement)
      ? document.activeElement
      : null;
    q("#task-make").hidden = tasks.length === items.length;
    q("#task-make").disabled = !canWrite;
    q("#task-remove").hidden = !tasks.length;
    q("#task-remove").disabled = !canWrite;
    q("#task-fields").hidden = !tasks.length;
    if (focused?.hidden)
      (focused.id === "task-make" && !q("#task-status")?.closest("[hidden]")
        ? q("#task-status")
        : q("#task-make:not([hidden])") || q("#task-remove:not([hidden])")
      )?.focus();
    q("#task-readonly").hidden = canWrite;
    if (!tasks.length) return keepFocus(focused);
    const value = (read) => same(tasks.map(read));
    const status = value((i) => i.task.status || "todo");
    options(
      q("#task-status"),
      STATUSES.map((s) => [s, t(STATUS_LABELS[s], "task")]),
      status,
      status === MIXED,
    );
    const priority = value((i) => i.task.priority || "");
    options(
      q("#task-priority"),
      [
        ["", t("None", "priority")],
        ...PRIORITIES.map((p) => [p, t(PRIORITY_LABELS[p])]),
      ],
      priority,
      priority === MIXED,
    );
    const assignee = value((i) => i.task.assignee?.id || "");
    const names = new Map(
      tasks
        .filter((i) => i.task.assignee)
        .map((i) => [i.task.assignee.id, i.task.assignee.name]),
    );
    // A member list arriving does not interrupt an assignee being typed.
    // Once focus leaves, the existing focusout refresh shows the picker.
    const typingAssignee = q("#task-assignee-text") === document.activeElement;
    if (people && typingAssignee) stale = true;
    if (people && !typingAssignee) {
      q("#task-assignee-field").hidden = false;
      q("#task-assignee-text-field").hidden = true;
      const list = new Map(people.map((p) => [p.id, p]));
      for (const [id, name] of names)
        if (!list.has(id)) list.set(id, { id, name, member: false });
      const entries = (member) =>
        [...list.values()]
          .filter((p) => !!p.member === member)
          .map((p) => [p.id, p.name, true]);
      const select = q("#task-assignee");
      // Everyone is on the board unless an administrator can also choose
      // from the organization; then the two kinds of people are grouped.
      if (entries(false).length) {
        const group = (label, list) =>
          list.length
            ? `<optgroup label="${escape(t(label))}">${listOptions(list, assignee, assignee === MIXED)}</optgroup>`
            : "";
        select.innerHTML =
          (assignee === MIXED
            ? `<option value="${MIXED}" disabled selected>${t("Mixed")}</option>`
            : "") +
          listOptions([["", t("Unassigned")]], assignee, assignee === MIXED) +
          group("On this board", entries(true)) +
          group("Not on this board", entries(false));
      } else
        options(
          select,
          [["", t("Unassigned")], ...entries(true)],
          assignee,
          assignee === MIXED,
        );
      q("#task-assignee-note").hidden =
        assignee === MIXED || !assignee || !!list.get(assignee)?.member;
    } else {
      q("#task-assignee-field").hidden = true;
      q("#task-assignee-text-field").hidden = false;
      const input = q("#task-assignee-text");
      fill(input, assignee === MIXED ? "" : names.get(assignee) || "");
      input.placeholder = assignee === MIXED ? t("Mixed") : t("Unassigned");
      // Names from tasks hidden from this person are not suggested.
      const hidden = api.concealed?.() ?? new Set();
      const known = new Set(
        board.items
          .filter(
            (i) => hasTask(i) && i.task.assignee?.name && !hidden.has(i.id),
          )
          .map((i) => i.task.assignee.name),
      );
      q("#task-assignee-names").innerHTML = [...known]
        .sort()
        .map((n) => `<option value="${escape(n)}"></option>`)
        .join("");
    }
    for (const field of ["start", "due"]) {
      const v = value((i) => i.task[field] || ""),
        input = q(`#task-${field}`);
      fill(input, v === MIXED ? "" : v);
      q(`#task-${field}-mixed`).hidden = v !== MIXED;
    }
    const linked = tasks.filter((i) => i.task.jira);
    q("#task-jira").innerHTML = linked.length
      ? `${t("Jira")}: ${linked
          .slice(0, 5)
          .map(
            (i) =>
              `${jiraLink(i.task.jira)}${i.task.jira.status ? ` <span data-user-content>(${escape(i.task.jira.status)})</span>` : ""}`,
          )
          .join(", ")}${linked.length > 5 ? ` +${linked.length - 5}` : ""}`
      : "";
    q("#task-jira-send").hidden = !api.jira.available();
    q("#task-jira-send").disabled = !canWrite;
    panel
      .querySelectorAll("#task-fields select, #task-fields input")
      .forEach((el) => (el.disabled = !canWrite));
    keepFocus(focused);
  }
  async function loadPeople() {
    const current = board;
    // The list from last time shows at once, then the one fetched now, so
    // people who joined or left the board since are offered correctly.
    const requests = new Set([api.people(), api.people(true)]);
    for (const request of requests)
      try {
        const list = await request;
        if (panel && board === current) {
          people = list;
          render();
        }
      } catch {
        /* Free text remains available when member lists cannot load. */
      }
  }
  function open() {
    const origin = document.activeElement;
    close();
    opener = origin && origin !== document.body ? origin : null;
    api.prepare();
    board = api.board();
    if (!board) return;
    ids = new Set(targets().map((i) => i.id));
    if (!ids.size)
      return api.toast("Select sticky notes, shapes, or text to plan tasks.");
    people = null;
    stale = false;
    panel = document.createElement("section");
    panel.id = "task-panel";
    panel.className = "task-panel panel";
    panel.setAttribute("aria-label", t("Task details"));
    panel.innerHTML = `<div class="search-heading"><strong>${t("Task details")}</strong><button type="button" class="text-btn" id="task-close">${t("Close")}</button></div><p id="task-summary" role="status"></p><p id="task-readonly" class="task-help" hidden>${t("You can view these task details but not change them.")}</p><div class="task-actions"><button type="button" class="primary" id="task-make">${t("Make task")}</button><button type="button" class="text-btn" id="task-remove">${t("Remove task details")}</button></div><div id="task-fields"><label class="field">${t("Status")}<select id="task-status"></select></label><label class="field" id="task-assignee-field">${t("Assignee")}<select id="task-assignee" aria-describedby="task-assignee-note"></select><small id="task-assignee-note" hidden>${t("Not on this board, so they are not notified and cannot open it. Share the board with them first.")}</small></label><label class="field" id="task-assignee-text-field" hidden>${t("Assignee")}<input id="task-assignee-text" maxlength="120" list="task-assignee-names" autocomplete="off"><datalist id="task-assignee-names"></datalist></label><div class="field-row"><label class="field">${t("Start date")}<input id="task-start" type="date" min="0100-01-01" max="9999-12-31"><small id="task-start-mixed" hidden>${t("Mixed")}</small></label><label class="field">${t("Due date")}<input id="task-due" type="date" min="0100-01-01" max="9999-12-31"><small id="task-due-mixed" hidden>${t("Mixed")}</small></label></div><label class="field">${t("Priority")}<select id="task-priority"></select></label><p id="task-jira" class="task-help"></p><button type="button" class="secondary" id="task-jira-send" hidden>${t("Send to Jira")}</button></div><p id="task-error" role="alert" hidden></p><p class="task-help">${t("Task details apply to every selected sticky note, shape, or text. Each change can be undone.")}</p>`;
    api.canvas().parentElement.append(panel);
    const q = (s) => panel.querySelector(s);
    q("#task-close").onclick = () => close(true);
    q("#task-make").onclick = () =>
      change((task) => task || newTask(), "Task details added.");
    q("#task-remove").onclick = () =>
      change(() => null, "Task details removed.");
    q("#task-status").onchange = (e) => setField("status", e.target.value);
    q("#task-priority").onchange = (e) =>
      setField("priority", e.target.value || null);
    q("#task-assignee").onchange = (e) =>
      setField(
        "assignee",
        e.target.value
          ? {
              id: e.target.value,
              name:
                e.target.selectedOptions[0]?.textContent.trim() ||
                e.target.value,
            }
          : null,
      );
    q("#task-assignee-text").onchange = (e) =>
      setField("assignee", assigneeFromName(e.target.value));
    for (const field of ["start", "due"])
      q(`#task-${field}`).onchange = (e) =>
        setField(field, e.target.value || null);
    // Sends already run one at a time; the button keeps keyboard focus.
    q("#task-jira-send").onclick = () => api.jira.send(selected());
    for (const event of ["copy", "cut", "paste"])
      panel.addEventListener(event, (e) => e.stopPropagation());
    // Once focus has moved on, the field it left shows the board's value,
    // which is what was just saved or what a collaborator set meanwhile.
    panel.addEventListener("focusout", () => {
      if (!stale) return;
      stale = false;
      signature = null;
      queueMicrotask(render);
    });
    panel.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        close(true);
      }
    });
    render();
    loadPeople();
    (q("#task-make").hidden ? q("#task-status") : q("#task-make")).focus();
  }
  return { open, close, render, isOpen: () => !!panel };
}
