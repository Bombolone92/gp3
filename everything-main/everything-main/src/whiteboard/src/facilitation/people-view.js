import { escape } from "../model.js";
import { labelled, language, t } from "../i18n.js";
import { canManage } from "../collaboration/protocol.js";
import { assignableRoles, ROLE_LABELS } from "../organization/board-access.js";
import { keepPaginationFocus } from "../paging.js";
import { renderHands } from "../live-ui.js";
import { workshopSettings } from "./model.js";
import { counted } from "./strings.js";

const PAGE_SIZE = 50;
const fill = (text, values) =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, () => value),
    t(text),
  );
const setText = (element, text) => {
  if (element.textContent !== text) element.textContent = text;
};

// The roster changes independently of the board. Keep search and paging
// controls mounted, and retain unchanged rows while live metadata arrives.
export function createPeopleView(api) {
  let boardId,
    session,
    generation = 0,
    query = "",
    page = 0,
    signature;
  let pendingVersion = 0;
  const pending = new Map();
  // Removing someone takes a second click, as in Share board: the person
  // whose Remove was clicked once, until it loses focus.
  let armed = null;
  const manage = () => canManage(api.role()) && api.canParticipate();
  // Who may open the board stays theirs to manage on an archived board,
  // as in Participants, though its content and activities are closed.
  const managesAccess = () =>
    canManage(api.role()) &&
    (api.managesAccess ? api.managesAccess() : api.canParticipate());
  // A guest is offered no more than the organization lets guests have.
  const limitFor = (person) => (person.guest ? api.guestRole?.() : undefined);
  const editable = (person) =>
    managesAccess() &&
    person.user !== api.identity().id &&
    person.role !== "owner" &&
    (api.role() === "owner" || person.role !== "facilitator");

  function reset() {
    boardId = session = signature = undefined;
    query = "";
    page = 0;
    generation++;
    pending.clear();
    armed = null;
  }
  function context() {
    const id = api.board()?.id,
      currentSession = api.session();
    if (boardId !== id) {
      reset();
      boardId = id;
    }
    if (session !== currentSession) {
      session = currentSession;
      generation++;
      pending.clear();
      signature = undefined;
    }
  }
  async function setRole(uuid, next) {
    context();
    const person = api.roster().find((p) => p.user === uuid);
    if (
      !session ||
      !api.board()?.shared ||
      !person ||
      !editable(person) ||
      pending.has(uuid) ||
      (next !== "removed" &&
        !assignableRoles(api.role(), limitFor(person)).includes(next))
    )
      return;
    const record = { next },
      token = generation,
      id = boardId,
      activeSession = session;
    const current = () =>
      generation === token &&
      api.board()?.id === id &&
      api.session() === activeSession;
    pending.set(uuid, record);
    pendingVersion++;
    api.refresh();
    try {
      await activeSession.request("role", { uuid, role: next });
      if (!current()) return;
      await activeSession.heartbeat();
      if (current())
        api.announce(
          t(next === "removed" ? "Participant removed." : "Role changed."),
        );
    } catch (error) {
      if (current()) api.toast(error.message);
    } finally {
      if (pending.get(uuid) === record) {
        pending.delete(uuid);
        pendingVersion++;
      }
      if (current()) api.refresh();
    }
  }
  // Who has a hand up shows by name to facilitators, and to everyone unless
  // input is anonymous.
  const named = () => manage() || !workshopSettings(api.board()).anonymous;
  function rowMarkup(person, raised) {
    const self = person.user === api.identity().id,
      working = pending.get(person.user);
    const selected =
      working && working.next !== "removed" ? working.next : person.role;
    const options = [
      ...new Set([
        person.role,
        ...assignableRoles(api.role(), limitFor(person)),
      ]),
    ];
    return `<span class="fac-person"><span data-user-content>${escape(person.username)}</span>${self ? ` (${t("you")})` : ""}</span><span class="badge">${t(ROLE_LABELS[person.role] || person.role)}</span>${person.guest ? `<span class="badge">${t("Guest")}</span>` : ""}${raised ? `<span class="badge raised-hand-badge">${t("Hand raised")}</span>` : ""}${
      editable(person)
        ? `<label class="sr-only" for="fac-role-${escape(person.user)}">${escape(`${t("Access for")} ${person.username}`)}</label><select id="fac-role-${escape(person.user)}" data-fac-role="${escape(person.user)}" ${working ? "disabled" : ""}>${options.map((r) => `<option value="${r}" ${r === selected ? "selected" : ""}>${t(ROLE_LABELS[r] || r)}</option>`).join("")}</select>${
            armed === person.user && !working
              ? `<button type="button" class="text-btn danger" data-fac="remove" data-id="${escape(person.user)}" data-confirm="true" aria-label="${escape(`${t("Confirm remove")} ${person.username}`)}">${t("Confirm remove")}</button>`
              : `<button type="button" class="text-btn" data-fac="remove" data-id="${escape(person.user)}" ${working ? "disabled" : ""} aria-label="${escape(`${t("Remove")} ${person.username}`)}">${t("Remove")}</button>`
          }`
        : ""
    }${manage() && !self ? `<button type="button" class="text-btn" data-fac="follow" data-id="${escape(person.sessions[0])}" aria-label="${escape(labelled(t("Ask to follow you"), person.username))}">${t("Ask to follow you")}</button>` : ""}`;
  }
  function render(content) {
    context();
    if (!api.board()?.shared || !session) {
      const text = t("Share this board to invite participants.");
      if (content.textContent !== text) {
        const focused = content.contains(content.ownerDocument.activeElement);
        content.innerHTML = `<p class="dialog-copy">${text}</p>`;
        if (focused) content.focus({ preventScroll: true });
      }
      signature = undefined;
      return;
    }
    let view = content.querySelector("#fac-people-view");
    if (!view) {
      content.innerHTML = `<section id="fac-people-view"><h3 id="fac-people-heading"></h3><div class="fac-actions"><button type="button" class="secondary" data-fac="bring"></button></div><section id="fac-hands" class="raised-hands" aria-labelledby="fac-hands-heading" hidden></section><div class="fac-people-controls"><label class="field"><span id="fac-people-label"></span><input id="fac-people-search" type="search" maxlength="100" aria-describedby="fac-people-count"></label><p id="fac-people-count" class="dialog-copy" role="status" aria-live="polite" aria-atomic="true"></p><div id="fac-people-pages" class="fac-people-pages"><button type="button" class="secondary" id="fac-people-prev"></button><button type="button" class="secondary" id="fac-people-next"></button></div></div><ul class="fac-people" aria-labelledby="fac-people-heading"></ul><p id="fac-people-empty" class="dialog-copy"></p></section><p id="fac-error" class="fac-error" role="alert" hidden></p>`;
      view = content.querySelector("#fac-people-view");
      const search = view.querySelector("#fac-people-search");
      search.value = query;
      search.oninput = () => {
        query = search.value;
        page = 0;
        content.scrollTop = 0;
        render(content);
      };
      view.querySelector("#fac-people-prev").onclick = () => {
        page--;
        content.scrollTop = 0;
        render(content);
      };
      view.querySelector("#fac-people-next").onclick = () => {
        page++;
        content.scrollTop = 0;
        render(content);
      };
      view.addEventListener("change", (event) => {
        if (!event.target.dataset.facRole) return;
        event.stopPropagation();
        if (!event.target.disabled)
          setRole(event.target.dataset.facRole, event.target.value);
      });
      // Moving on from Confirm remove puts Remove back, once focus has
      // landed, so a redrawn row keeps it where it went.
      view.addEventListener("focusout", (event) => {
        if (event.target.dataset?.fac !== "remove" || armed === null) return;
        setTimeout(() => {
          if (
            armed === null ||
            content.ownerDocument.activeElement?.dataset?.confirm
          )
            return;
          armed = null;
          render(content);
        });
      });
      view.addEventListener("click", (event) => {
        const lower = event.target.closest("[data-lower-hand]");
        if (lower) {
          event.stopPropagation();
          api.lowerHand?.(lower.dataset.lowerHand);
          return;
        }
        const button = event.target.closest("[data-fac]");
        if (!button) return;
        event.stopPropagation();
        if (button.disabled) return;
        if (button.dataset.fac === "remove") {
          if (!managesAccess()) return;
          if (armed === button.dataset.id) {
            armed = null;
            setRole(button.dataset.id, "removed");
          } else {
            armed = button.dataset.id;
            render(content);
          }
        } else if (!manage()) return;
        else if (button.dataset.fac === "follow") api.follow(button.dataset.id);
        else if (button.dataset.fac === "bring") api.bring();
      });
      signature = undefined;
    }
    const roster = api.roster();
    const hands = api.hands?.() || [];
    if (
      renderHands(view.querySelector("#fac-hands"), hands, {
        manage: manage(),
        anonymous: !named(),
      })
    )
      view.querySelector("#fac-people-search").focus({ preventScroll: true });
    const raised = named()
      ? new Set(hands.map((h) => h.user ?? h.session))
      : new Set();
    const nextSignature = JSON.stringify([
      [...raised],
      roster.map((p) => [p.user, p.username, p.role, p.guest, p.session]),
      api.role(),
      manage(),
      managesAccess(),
      api.identity().id,
      language,
      query,
      page,
      pendingVersion,
      armed,
    ]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    const people = new Map();
    for (const person of roster) {
      const entry = people.get(person.user) || { ...person, sessions: [] };
      entry.sessions.push(person.session);
      people.set(person.user, entry);
    }
    const needle = query.trim().toLocaleLowerCase();
    const matches = [...people.values()]
      .filter((p) =>
        `${p.username} ${p.role} ${t(ROLE_LABELS[p.role] || p.role)} ${p.guest ? t("Guest") : ""}`
          .toLocaleLowerCase()
          .includes(needle),
      )
      .sort((a, b) => a.username.localeCompare(b.username));
    page = Math.max(
      0,
      Math.min(page, Math.ceil(matches.length / PAGE_SIZE) - 1),
    );
    const shown = matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const search = view.querySelector("#fac-people-search"),
      previous = view.querySelector("#fac-people-prev"),
      next = view.querySelector("#fac-people-next");
    if (search.value !== query) search.value = query;
    const active = content.ownerDocument.activeElement,
      activeRow = active.closest?.("[data-fac-person]");
    const activeKey = active.dataset.facRole ? "role" : active.dataset.fac;
    const list = view.querySelector(".fac-people");
    const oldRows = [...list.children],
      rows = new Map(oldRows.map((row) => [row.dataset.facPerson, row]));
    const keep = new Set(shown.map((p) => p.user));
    for (const person of shown) {
      let row = rows.get(person.user);
      if (!row) {
        row = content.ownerDocument.createElement("li");
        row.dataset.facPerson = person.user;
        rows.set(person.user, row);
      }
      const markup = rowMarkup(person, raised.has(person.user));
      if (row._peopleMarkup !== markup) {
        row.innerHTML = markup;
        row._peopleMarkup = markup;
      }
      if (pending.has(person.user)) row.setAttribute("aria-busy", "true");
      else row.removeAttribute("aria-busy");
    }
    for (const row of oldRows)
      if (!keep.has(row.dataset.facPerson)) row.remove();
    let position = list.firstElementChild;
    for (const person of shown) {
      const row = rows.get(person.user);
      if (row === position) position = position.nextElementSibling;
      else list.insertBefore(row, position);
    }
    setText(
      view.querySelector("#fac-people-heading"),
      fill("Present now ({count})", { count: people.size }),
    );
    setText(view.querySelector("#fac-people-label"), t("Find a participant"));
    setText(
      view.querySelector("#fac-people-count"),
      matches.length
        ? fill("Showing participants {from}–{to} of {total}.", {
            from: page * PAGE_SIZE + 1,
            to: page * PAGE_SIZE + shown.length,
            total: matches.length,
          })
        : counted("{count} participants", 0).replaceAll("{count}", "0"),
    );
    setText(previous, t("Previous"));
    setText(next, t("Next"));
    previous.disabled = page === 0;
    next.disabled = (page + 1) * PAGE_SIZE >= matches.length;
    view.querySelector("#fac-people-pages").hidden =
      matches.length <= PAGE_SIZE;
    const empty = view.querySelector("#fac-people-empty");
    empty.hidden = !!matches.length;
    setText(
      empty,
      t(
        needle
          ? "No participants match your search."
          : "No participants are on this board.",
      ),
    );
    const bring = view.querySelector('[data-fac="bring"]');
    bring.parentElement.hidden = !manage();
    setText(bring, t("Bring everyone to my view"));
    keepPaginationFocus(active, previous, next, search);
    if (activeRow && view.contains(activeRow)) {
      const replacement =
        activeKey === "role"
          ? activeRow.querySelector("select")
          : [...activeRow.querySelectorAll("button")].find(
              (b) => b.dataset.fac === activeKey,
            );
      const target =
        replacement && !replacement.disabled ? replacement : search;
      if (content.ownerDocument.activeElement !== target)
        target.focus({ preventScroll: true });
    } else if (activeRow && oldRows.includes(activeRow)) {
      const row =
        list.children[
          Math.min(oldRows.indexOf(activeRow), list.children.length - 1)
        ];
      const replacement =
        activeKey === "role"
          ? row?.querySelector("select")
          : [...(row?.querySelectorAll("button") || [])].find(
              (b) => b.dataset.fac === activeKey,
            );
      (replacement && !replacement.disabled ? replacement : search).focus({
        preventScroll: true,
      });
    } else if (active === bring && bring.parentElement.hidden)
      search.focus({ preventScroll: true });
  }
  return { render, reset };
}
