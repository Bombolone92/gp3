import { plural, t } from "./i18n.js";
import {
  captureCamera,
  cameraView,
  followCycle,
} from "./collaboration/attention.js";
import { keepPageFocus } from "./paging.js";

const setProperty = (element, name, value) => {
  if (element[name] !== value) element[name] = value;
};
const setText = (element, value) => setProperty(element, "textContent", value);
const setLabel = (element, value) => {
  if (element.getAttribute("aria-label") !== value)
    element.setAttribute("aria-label", value);
};

export function createAttentionUI(api) {
  let root,
    host,
    frame,
    target = null,
    pending = null,
    pendingFocus = null,
    dialog,
    query = "",
    page = 0;
  let views = new Map(),
    roster = [],
    lastBanner,
    presentation,
    countTimer = null,
    // How many followed as the banner last said, or 0.
    countShown = 0,
    settling = false;
  let showCursors = true;
  try {
    showCursors = localStorage.getItem("whiteboard-show-cursors") !== "false";
  } catch {}
  const session = () => api.session();
  const sourceCamera = () =>
    presentation?.camera ||
    (target && views.get(target)?.camera) ||
    captureCamera(api.view(), api.size());
  function capture() {
    const s = session();
    if (!s || s.closed) return;
    const camera = sourceCamera();
    if (camera) s.view(camera, target);
  }
  function stop(message) {
    if (!target && !pending) return;
    target = pending = pendingFocus = null;
    capture();
    render();
    if (message) api.toast(message);
  }
  function follow(id, explicit = true) {
    const s = session(),
      person = views.get(id);
    if (
      !s ||
      id === s.session ||
      !person ||
      !roster.some((p) => p.session === id)
    )
      return false;
    if (followCycle(views, id, s.session)) {
      api.toast("Cannot follow a circular chain.");
      return false;
    }
    if (explicit) api.prepare();
    target = id;
    pending = pendingFocus = null;
    apply();
    capture();
    render();
    return true;
  }
  function apply() {
    const s = session();
    if (!s || !target) return;
    if (!views.has(target) || !roster.some((p) => p.session === target))
      return stop("Following stopped because the live view is unavailable.");
    if (followCycle(views, target, s.session))
      return stop("Following stopped to avoid a loop.");
    if (api.busy()) return;
    const next = cameraView(views.get(target).camera, api.size()),
      current = api.view();
    if (
      next &&
      ["x", "y", "z"].some((k) => Math.abs(next[k] - current[k]) > 1e-6)
    )
      api.navigate(next);
  }
  function update(nextViews, nextRoster) {
    views = nextViews;
    roster = nextRoster;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      apply();
      if (pending && !views.has(pending)) pending = pendingFocus = null;
      render();
    });
  }
  function receive(person) {
    if (!session() || person.session === session().session) return;
    if (api.busy()) {
      pending = person.session;
      pendingFocus = document.activeElement;
      render();
    } else follow(person.session, false);
  }
  // On a locked workshop board only facilitators move others' views.
  const mayBring = (s) =>
    !s.readOnly && !s.contentReadOnly && (api.canBring?.() ?? true);
  async function bring(id = "all") {
    const s = session();
    if (!s || !mayBring(s)) return;
    stop();
    capture();
    try {
      const sent = await s.bring(id);
      api.toast(
        sent
          ? "Asked participants to follow you."
          : "A live connection is needed to bring participants to your view.",
      );
    } catch {
      api.toast("Could not send the follow request. Try again.");
    }
  }
  function manual(e) {
    // Typing, panel controls, and buttons over the board, such as the
    // toolbars, Participants, and vote badges, are not canvas navigation.
    // Actions that move the view (zoom, minimap, search) stop following
    // themselves.
    if (
      root?.contains(e?.target) ||
      e?.target?.closest?.(
        "input,textarea,select,button,[contenteditable],.panel,.canvas-top,.canvas-bottom",
      )
    )
      return;
    stop();
  }
  function keydown(e) {
    if (!target && !pending) return;
    // Escape first belongs to what the person is doing, such as typing a
    // note or dragging, which an invitation waits for.
    if (
      e.key === "Escape" &&
      !e.isComposing &&
      !api.busy() &&
      (root?.contains(e.target) || !e.target.closest?.(".panel"))
    ) {
      e.preventDefault();
      e.stopPropagation();
      stop();
    } else if (
      !e.isComposing &&
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "+",
        "-",
        "=",
        " ",
        "PageUp",
        "PageDown",
        "Home",
        "End",
      ].includes(e.key)
    )
      manual(e);
  }
  function detach() {
    if (frame) cancelAnimationFrame(frame);
    frame = null;
    clearTimeout(countTimer);
    countTimer = null;
    countShown = 0;
    host?.removeEventListener("pointerdown", manual, true);
    host?.removeEventListener("wheel", manual, true);
    host?.removeEventListener("keydown", keydown, true);
    root?.remove();
    root = host = null;
  }
  function bind(element) {
    detach();
    host = element;
    lastBanner = null;
    root = document.createElement("div");
    root.className = "follow-banner panel";
    root.hidden = true;
    root.innerHTML = `<span role="status" aria-live="polite" data-follow-label></span><button class="secondary" data-follow-accept hidden>${t("Follow")}</button><button class="text-btn" data-follow-stop>${t("Stop following")}</button>`;
    root.querySelector("[data-follow-stop]").onclick = () => {
      const previous = pending && pendingFocus;
      // Dismissing an invitation keeps following whoever was followed before.
      if (pending && target) {
        pending = pendingFocus = null;
        render();
      } else stop();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      else api.focusCanvas();
    };
    root.querySelector("[data-follow-accept]").onclick = () => {
      const id = pending;
      if (id && follow(id)) api.focusCanvas();
    };
    host.append(root);
    host.addEventListener("pointerdown", manual, true);
    host.addEventListener("wheel", manual, { capture: true, passive: true });
    host.addEventListener("keydown", keydown, true);
    render();
  }
  function render() {
    const s = session();
    const followers = s
      ? [...views.values()].filter((p) => p.following === s.session).length
      : 0;
    const person = views.get(pending || target);
    const label =
      pending && person
        ? `${person.username} · ${t("Invited you to follow")}`
        : target && person
          ? `${t("Following")} ${person.username}`
          : followers
            ? plural(
                followers,
                "{count} following you",
                "{count} following you",
              )
            : "";
    const sig = `${label}:${!!pending}:${!!target}`;
    if (root && sig !== lastBanner) {
      // The banner is read out as it changes. A change in how many follow
      // waits a moment, so bringing a whole workshop along is announced
      // once rather than once for each person.
      const counting = !pending && !target && followers > 0;
      if (counting && countShown && countShown !== followers && !settling) {
        countTimer ??= setTimeout(() => {
          countTimer = null;
          settling = true;
          render();
          settling = false;
        }, 1000);
        return renderDialog();
      }
      clearTimeout(countTimer);
      countTimer = null;
      countShown = counting && followers;
      lastBanner = sig;
      const focused = document.activeElement;
      root.hidden = !label;
      root.querySelector("[data-follow-label]").textContent = label;
      root.querySelector("[data-follow-accept]").hidden = !pending;
      const stopButton = root.querySelector("[data-follow-stop]");
      stopButton.hidden = !target && !pending;
      stopButton.textContent = t(pending ? "Dismiss" : "Stop following");
      if (root.contains(focused) && focused.closest("[hidden]")) {
        if (!root.hidden && !stopButton.hidden)
          stopButton.focus({ preventScroll: true });
        else api.focusCanvas();
      }
    }
    renderDialog();
  }
  function renderDialog() {
    if (!dialog?.isConnected || !session()) return;
    const s = session(),
      needle = query.trim().toLocaleLowerCase(),
      focused = document.activeElement;
    const people = roster.filter(
      (p) =>
        p.session !== s.session &&
        (!needle || p.username.toLocaleLowerCase().includes(needle)),
    );
    page = Math.min(page, Math.max(0, Math.ceil(people.length / 50) - 1));
    const shown = people.slice(page * 50, (page + 1) * 50),
      list = dialog.querySelector("#live-participant-list"),
      currentRows = [...list.children],
      rowsBySession = new Map(
        currentRows.map((row) => [row.dataset.session, row]),
      );
    const keep = new Set();
    for (const p of shown) {
      keep.add(p.session);
      let row = rowsBySession.get(p.session);
      if (!row) {
        row = document.createElement("div");
        row.className = "live-participant-row";
        row.dataset.session = p.session;
        const name = document.createElement("span");
        name.dataset.userContent = "";
        const state = document.createElement("small");
        const followButton = document.createElement("button");
        followButton.className = "secondary";
        followButton.dataset.follow = p.session;
        const bringButton = document.createElement("button");
        bringButton.className = "secondary";
        bringButton.dataset.bring = p.session;
        followButton.onclick = () => {
          const d = dialog;
          d.close();
          if (target === p.session) stop();
          else follow(p.session);
          api.focusCanvas();
        };
        bringButton.onclick = () => bring(p.session);
        row.append(name, state, followButton, bringButton);
        list.append(row);
        rowsBySession.set(p.session, row);
      }
      const [name, state, followButton, bringButton] = row.children;
      setText(name, p.username);
      const live = views.has(p.session),
        following = target === p.session;
      setText(
        state,
        t(
          live
            ? views.get(p.session).following === s.session
              ? "Following you"
              : "Live"
            : "Waiting for live view",
        ),
      );
      setText(followButton, t(following ? "Stop following" : "Follow"));
      setProperty(
        followButton,
        "disabled",
        !live || (!following && followCycle(views, p.session, s.session)),
      );
      setLabel(
        followButton,
        `${t(following ? "Stop following" : "Follow")} ${p.username}`,
      );
      setText(bringButton, t("Bring to me"));
      setProperty(bringButton, "disabled", !mayBring(s) || !live);
      setLabel(bringButton, `${t("Bring to me")} · ${p.username}`);
    }
    // A focused control whose participant left gives focus to the same
    // control of the row now in its place, or to the search field.
    const active = focused,
      leaving = currentRows.find(
        (row) => !keep.has(row.dataset.session) && row.contains(active),
      ),
      place = leaving ? currentRows.indexOf(leaving) : -1,
      column = leaving ? [...leaving.children].indexOf(active) : -1;
    for (const row of currentRows)
      if (!keep.has(row.dataset.session)) row.remove();
    // Rows kept from an earlier search or roster stay in the roster's
    // order, and a control that had focus keeps it when its row moves.
    let next = list.firstElementChild;
    for (const p of shown) {
      const row = rowsBySession.get(p.session);
      if (row === next) next = next.nextElementSibling;
      else list.insertBefore(row, next);
    }
    if (
      list.contains(focused) &&
      !focused.disabled &&
      document.activeElement !== focused
    )
      focused.focus({ preventScroll: true });
    if (leaving) {
      const rows = [...list.children],
        control = rows[Math.min(place, rows.length - 1)]?.children[column];
      (control && !control.disabled
        ? control
        : dialog.querySelector("#live-participant-search")
      ).focus({ preventScroll: true });
    }
    const empty = dialog.querySelector("#live-participant-empty");
    setProperty(empty, "hidden", !!people.length);
    setText(
      empty,
      t(
        needle
          ? "No participants match your search."
          : "No other participants are on this board.",
      ),
    );
    setText(
      dialog.querySelector("#live-participant-count"),
      plural(people.length, "{count} participant", "{count} participants"),
    );
    const previous = dialog.querySelector("#live-participant-prev"),
      nextPage = dialog.querySelector("#live-participant-next"),
      pages = dialog.querySelector("#live-participant-pages");
    setProperty(previous, "disabled", page === 0);
    setProperty(nextPage, "disabled", (page + 1) * 50 >= people.length);
    setProperty(pages, "hidden", people.length <= 50);
    if (focused === previous || focused === nextPage) {
      if (pages.hidden)
        dialog
          .querySelector("#live-participant-search")
          .focus({ preventScroll: true });
      else if (focused.disabled)
        (focused === previous ? nextPage : previous).focus({
          preventScroll: true,
        });
    }
    const everyone = dialog.querySelector("#bring-everyone");
    setProperty(
      everyone,
      "disabled",
      !mayBring(s) ||
        ![...views.keys()].some((id) => roster.some((p) => p.session === id)),
    );
    if (focused.disabled && (list.contains(focused) || focused === everyone))
      dialog
        .querySelector("#live-participant-search")
        .focus({ preventScroll: true });
  }
  function mountDialog(d) {
    dialog = d;
    query = "";
    page = 0;
    const section = document.createElement("section");
    section.className = "live-participants";
    section.innerHTML = `<h3>${t("Live navigation")}</h3><p class="dialog-copy">${t("Follow a participant’s view. Pan, zoom, click the board, or press Escape to stop.")}</p><div class="live-participant-controls"><button class="secondary" id="bring-everyone">${t("Bring everyone to me")}</button><label><input type="checkbox" id="show-cursors" ${showCursors ? "checked" : ""}>${t("Show collaborator cursors")}</label></div><label class="field">${t("Find a participant")}<input id="live-participant-search" type="search" maxlength="100"></label><p id="live-participant-count" class="dialog-copy"></p><div id="live-participant-list"></div><p id="live-participant-empty" class="dialog-copy">${t("No other participants are on this board.")}</p><div id="live-participant-pages"><button class="secondary" id="live-participant-prev">${t("Previous")}</button><button class="secondary" id="live-participant-next">${t("Next")}</button></div>`;
    d.querySelector("#participant-list").before(section);
    d.querySelector("#bring-everyone").onclick = () => bring();
    d.querySelector("#show-cursors").onchange = (e) => {
      showCursors = e.target.checked;
      try {
        localStorage.setItem("whiteboard-show-cursors", String(showCursors));
      } catch {}
      api.redrawCursors();
    };
    d.querySelector("#live-participant-search").oninput = (e) => {
      query = e.target.value;
      page = 0;
      renderDialog();
    };
    const previous = d.querySelector("#live-participant-prev"),
      next = d.querySelector("#live-participant-next");
    previous.onclick = () => {
      page--;
      renderDialog();
      keepPageFocus(previous, next);
    };
    next.onclick = () => {
      page++;
      renderDialog();
      keepPageFocus(next, previous);
    };
    d.addEventListener(
      "close",
      () => {
        if (dialog === d) dialog = null;
      },
      { once: true },
    );
    renderDialog();
  }
  function present(d, rect) {
    if (presentation?.dialog !== d)
      d.addEventListener(
        "close",
        () => {
          if (presentation?.dialog === d) {
            presentation = null;
            capture();
          }
        },
        { once: true },
      );
    presentation = {
      dialog: d,
      camera: {
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h / 2,
        w: rect.w,
        h: rect.h,
      },
    };
    capture();
  }
  function reset() {
    presentation = null;
    target = pending = pendingFocus = null;
    views = new Map();
    roster = [];
    detach();
    dialog = null;
  }
  return {
    bind,
    present,
    resize: apply,
    detach,
    reset,
    update,
    receive,
    follow,
    bring,
    stop,
    manual,
    capture,
    mountDialog,
    showCursors: () => showCursors,
    following: () => target,
  };
}
