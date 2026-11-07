import { language, plural, t } from "./i18n.js";
import {
  captureCamera,
  cameraView,
  followCycle,
} from "./collaboration/attention.js";
import { keepPageFocus } from "./paging.js";
import { raisedHands } from "./collaboration/live.js";
import { renderHands } from "./live-ui.js";

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
    settling = false,
    // The slide shown while following a presenter, and its pending redraw.
    slide = null,
    slideFrame = null,
    // Someone the banner offers to follow, and the last one dismissed.
    offered = null,
    dismissed = null,
    // The raised hands as last passed on.
    handsSignature = "";
  let showCursors = true;
  try {
    showCursors = localStorage.getItem("whiteboard-show-cursors") !== "false";
  } catch {}
  const session = () => api.session();
  const sourceCamera = () =>
    presentation?.camera ||
    (target && views.get(target)?.camera) ||
    captureCamera(api.view(), api.size());
  // A presenter shares the slide shown, and so does whoever follows them.
  const sourceSlide = () =>
    presentation
      ? presentation.slide
      : (target && views.get(target)?.slide) || null;
  function capture() {
    const s = session();
    if (!s || s.closed) return;
    const camera = sourceCamera();
    if (camera) s.view(camera, target, sourceSlide());
  }
  // Following someone who presents shows their slide alone, as they see
  // it, over the board: nothing beside or beyond it, whatever the screen's
  // proportions. Stopping, or the presentation ending, shows the board.
  function showSlide(person) {
    if (!person?.slide || !host || !api.paintSlide) return hideSlide();
    if (!slide) {
      slide = document.createElement("section");
      slide.className = "follow-slide";
      slide.setAttribute("aria-label", t("Presentation"));
      slide.innerHTML = `<canvas role="img" tabindex="0" aria-labelledby="follow-slide-title" aria-describedby="follow-slide-outline"></canvas><p class="follow-slide-title" id="follow-slide-title" role="status" aria-live="polite"></p><div id="follow-slide-outline" class="sr-only"></div>`;
      const board = host.querySelector("canvas");
      if (board) board.after(slide);
      else host.prepend(slide);
      host.classList.add("following-slide");
    }
    const shown = api.paintSlide(
      slide.querySelector("canvas"),
      person.camera,
      person.slide,
    );
    if (!shown) return hideSlide();
    const title = `${person.slide.at} / ${person.slide.of} · ${shown.name}`;
    const label = slide.querySelector(".follow-slide-title");
    if (label.innerHTML !== title) label.innerHTML = title;
    const outline = slide.querySelector("#follow-slide-outline");
    if (outline.innerHTML !== shown.outline) outline.innerHTML = shown.outline;
  }
  function hideSlide() {
    if (slideFrame) cancelAnimationFrame(slideFrame);
    slideFrame = null;
    if (!slide) return;
    const focused = slide.contains(document.activeElement);
    slide.remove();
    slide = null;
    host?.classList.remove("following-slide");
    if (focused) api.focusCanvas();
  }
  // The board changed under the slide, as when someone edits the frame.
  function redraw() {
    if (!slide || slideFrame) return;
    slideFrame = requestAnimationFrame(() => {
      slideFrame = null;
      if (slide && target && !api.busy()) showSlide(views.get(target));
    });
  }
  function stop(message) {
    if (!target && !pending) return;
    target = pending = pendingFocus = null;
    hideSlide();
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
    const person = views.get(target),
      next = cameraView(person.camera, api.size()),
      current = api.view();
    // The board behind the slide moves along too, so it is where the
    // presenter was once following stops.
    if (
      next &&
      ["x", "y", "z"].some((k) => Math.abs(next[k] - current[k]) > 1e-6)
    )
      api.navigate(next);
    showSlide(person);
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
    // Alone on the board there is no one to bring. Agenda steps and frame
    // reveals ask for everyone without a word, so nothing is said.
    if (id === "all" && !roster.some((p) => p.session !== s.session)) return;
    stop();
    capture();
    try {
      const sent = await s.bring(id);
      // Asking one person names them.
      const name =
        id !== "all" && roster.find((p) => p.session === id)?.username;
      api.toast(
        !sent
          ? "A live connection is needed to bring participants to your view."
          : name
            ? t("Asked {name} to follow you.").replace("{name}", () => name)
            : "Asked participants to follow you.",
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
    hideSlide();
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
      // A dismissed offer stays away until someone else leads.
      if (offered && !pending && !target) {
        dismissed = offered;
        render();
      } else if (pending && target) {
        // Dismissing an invitation keeps following whoever was followed
        // before.
        pending = pendingFocus = null;
        render();
      } else stop();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      else api.focusCanvas();
    };
    root.querySelector("[data-follow-accept]").onclick = () => {
      const id = pending || offered;
      if (id && follow(id)) api.focusCanvas();
    };
    host.append(root);
    host.addEventListener("pointerdown", manual, true);
    host.addEventListener("wheel", manual, { capture: true, passive: true });
    host.addEventListener("keydown", keydown, true);
    render();
  }
  // Whom someone not following anyone could join: a presenter, or else
  // whoever at least two others follow, as after Bring everyone to me or an
  // agenda step. A request to follow reaches only those on the board when
  // it is made, so people who arrive later, or stopped following, find the
  // session here rather than only in Participants.
  function leader(s) {
    const counts = new Map();
    for (const v of views.values())
      if (v.following)
        counts.set(v.following, (counts.get(v.following) || 0) + 1);
    let best = null,
      rank = 0;
    for (const [id, v] of views) {
      if (
        id === s.session ||
        v.following ||
        !roster.some((p) => p.session === id)
      )
        continue;
      const next = (v.slide ? 1e6 : 0) + (counts.get(id) || 0);
      if ((v.slide || next >= 2) && next > rank) {
        best = id;
        rank = next;
      }
    }
    return best;
  }
  function render() {
    const s = session();
    const followers = s
      ? [...views.values()].filter((p) => p.following === s.session).length
      : 0;
    offered =
      s && !pending && !target && !followers && !presentation
        ? leader(s)
        : null;
    if (dismissed && dismissed !== offered) dismissed = null;
    if (offered && offered === dismissed) offered = null;
    const person = views.get(pending || target || offered);
    const label =
      pending && person
        ? `${person.username} · ${t("Invited you to follow")}`
        : target && person
          ? `${t("Following")} ${person.username}`
          : offered && person
            ? person.slide
              ? `${person.username} · ${t("Presenting")}`
              : `${t("Others are following")} ${person.username}`
            : followers
              ? plural(
                  followers,
                  "{count} following you",
                  "{count} following you",
                )
              : "";
    const sig = `${label}:${!!pending}:${!!target}:${!!offered}`;
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
        return renderControls();
      }
      clearTimeout(countTimer);
      countTimer = null;
      countShown = counting && followers;
      lastBanner = sig;
      const focused = document.activeElement;
      root.hidden = !label;
      root.querySelector("[data-follow-label]").textContent = label;
      const accept = root.querySelector("[data-follow-accept]");
      accept.hidden = !pending && !offered;
      setLabel(accept, `${t("Follow")} ${person?.username ?? ""}`.trim());
      const stopButton = root.querySelector("[data-follow-stop]");
      stopButton.hidden = !target && !pending && !offered;
      stopButton.textContent = t(
        pending || offered ? "Dismiss" : "Stop following",
      );
      if (root.contains(focused) && focused.closest("[hidden]")) {
        if (!root.hidden && !stopButton.hidden)
          stopButton.focus({ preventScroll: true });
        else api.focusCanvas();
      }
    }
    renderControls();
  }
  function renderControls() {
    renderPresentation();
    renderDialog();
    const list = hands(),
      next = JSON.stringify(
        list.map((h) => [h.user ?? h.session, h.username, h.hand, h.sessions]),
      );
    if (next !== handsSignature) {
      handsSignature = next;
      api.handsChanged?.(list);
    }
  }
  // Raised hands on the board, this person's included, in the order they
  // went up.
  function hands() {
    const s = session();
    return s
      ? raisedHands(views, roster, { session: s.session, hand: s.hand })
      : [];
  }
  // Someone else live on the board who can be brought along.
  const anyoneLive = () =>
    [...views.keys()].some((id) => roster.some((p) => p.session === id));
  // The presentation covers the board's own controls, so a presenter on a
  // shared board brings the audience to the slides from inside it.
  function renderPresentation() {
    const button = presentation?.dialog?.querySelector("[data-present-bring]");
    if (!button) return;
    const s = session();
    const count = presentation.dialog.querySelector("[data-present-followers]");
    if (count) {
      const followers = s
        ? [...views.values()].filter((p) => p.following === s.session).length
        : 0;
      setProperty(count, "hidden", !followers);
      setText(
        count,
        followers
          ? plural(followers, "{count} following you", "{count} following you")
          : "",
      );
    }
    // Viewers and commenters never bring anyone; a facilitator's lock on a
    // workshop board, or an empty room, only holds the button for now.
    setProperty(button, "hidden", !s || s.readOnly || s.contentReadOnly);
    const disabled = button.hidden || !mayBring(s) || !anyoneLive();
    if (button.disabled === disabled) return;
    const focused = document.activeElement === button;
    button.disabled = disabled;
    if (focused && disabled)
      presentation.dialog.querySelector("canvas")?.focus({
        preventScroll: true,
      });
  }
  function renderDialog() {
    if (!dialog?.isConnected || !session()) return;
    const s = session(),
      needle = query.trim().toLocaleLowerCase(),
      focused = document.activeElement;
    // The roster has an entry per open tab. Each other person is listed
    // once, by name, with one tab to follow: the one followed now, else
    // their latest live one. This person's own other tabs are not listed.
    const self = roster.find((p) => p.session === s.session)?.user,
      byPerson = new Map();
    for (const p of roster) {
      if (p.session === s.session || (self && p.user === self)) continue;
      const key = p.user ?? p.session,
        rank = p.session === target ? 2 : views.has(p.session) ? 1 : 0;
      if (rank >= (byPerson.get(key)?.rank ?? 0))
        byPerson.set(key, { ...p, rank });
    }
    // Who has a hand up shows by name to facilitators, and to everyone
    // unless input is anonymous.
    const handList = hands(),
      manage = !!api.canManage?.(),
      named = manage || !api.anonymous?.(),
      raised = new Set(handList.map((h) => h.user ?? h.session));
    if (
      renderHands(dialog.querySelector("#raised-hands"), handList, {
        manage,
        anonymous: !named,
      })
    )
      dialog
        .querySelector("#live-participant-search")
        .focus({ preventScroll: true });
    const collator = new Intl.Collator(language, { numeric: true });
    const people = [...byPerson.values()]
      .filter((p) => !needle || p.username.toLocaleLowerCase().includes(needle))
      .sort((a, b) => collator.compare(a.username, b.username));
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
      const status = t(
        live
          ? views.get(p.session).following === s.session
            ? "Following you"
            : "Live"
          : "Not live yet",
      );
      setText(
        state,
        named && raised.has(p.user ?? p.session)
          ? `${status} · ${t("Hand raised")}`
          : status,
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
    // The empty-state sentence already says no one else is here; a count
    // of zero above it would say the same thing twice.
    const countLine = dialog.querySelector("#live-participant-count");
    setProperty(countLine, "hidden", !people.length);
    // Unsearched, it counts everyone on the board as the Participants
    // button does, this person too.
    setText(
      countLine,
      needle
        ? plural(people.length, "{count} participant", "{count} participants")
        : plural(
            new Set(roster.map((p) => p.user ?? p.session)).size || 1,
            "{count} participant, including you",
            "{count} participants, including you",
          ),
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
    setProperty(everyone, "disabled", !mayBring(s) || !anyoneLive());
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
    section.innerHTML = `<h3>${t("Live navigation")}</h3><p class="dialog-copy">${t("Follow a participant’s view. Pan, zoom, click the board, or press Escape to stop.")}</p><div class="live-participant-controls"><button class="secondary" id="bring-everyone">${t("Bring everyone to me")}</button><label><input type="checkbox" id="show-cursors" ${showCursors ? "checked" : ""}>${t("Show collaborator cursors")}</label></div><section id="raised-hands" class="raised-hands" aria-labelledby="raised-hands-heading" hidden></section><label class="field">${t("Find a participant")}<input id="live-participant-search" type="search" maxlength="100"></label><p id="live-participant-count" class="dialog-copy" role="status" aria-live="polite" aria-atomic="true"></p><div id="live-participant-list"></div><p id="live-participant-empty" class="dialog-copy" role="status" aria-live="polite" aria-atomic="true">${t("No other participants are on this board.")}</p><div id="live-participant-pages"><button class="secondary" id="live-participant-prev">${t("Previous")}</button><button class="secondary" id="live-participant-next">${t("Next")}</button></div>`;
    d.querySelector("#participant-list").before(section);
    d.querySelector("#bring-everyone").onclick = () => bring();
    d.querySelector("#raised-hands").onclick = (e) => {
      const lower = e.target.closest("[data-lower-hand]");
      if (lower) api.lowerHand?.(lower.dataset.lowerHand);
    };
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
  function present(d, rect, slide = null) {
    if (presentation?.dialog !== d && session()) {
      const button = document.createElement("button");
      button.className = "secondary";
      button.dataset.presentBring = "";
      button.textContent = t("Bring everyone to me");
      button.onclick = () => bring();
      // The presentation covers the board's banner, which says how many
      // follow; the count is shown here instead.
      const count = document.createElement("span");
      count.className = "present-followers";
      count.dataset.presentFollowers = "";
      count.hidden = true;
      d.querySelector("#slide-fullscreen")?.before(count, button);
    }
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
      slide,
      camera: {
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h / 2,
        w: rect.w,
        h: rect.h,
      },
    };
    capture();
    renderPresentation();
  }
  function reset() {
    presentation = null;
    handsSignature = "";
    target = pending = pendingFocus = offered = dismissed = null;
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
    redraw,
    showingSlide: () => !!slide,
    receive,
    follow,
    bring,
    stop,
    manual,
    capture,
    mountDialog,
    hands,
    refresh: () => render(),
    showCursors: () => showCursors,
    following: () => target,
  };
}
