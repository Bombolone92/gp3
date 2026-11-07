// Canvas badges for reactions, dot votes, and hidden contributions, plus the
// reaction picker shared by board objects and comment messages. Badges are
// DOM buttons positioned over the canvas and culled to the viewport.
import { objectBounds } from "../geometry.js";
import { escape, uid } from "../model.js";
import { labelled, t } from "../i18n.js";
import { counted } from "./strings.js";
import {
  REACTIONS,
  messageTarget,
  objectTarget,
  reactionSummary,
  targetKey,
} from "./model.js";

const MAX_BADGES = 300;
export function createOverlay(ctx) {
  let layer, picker;
  const nodes = new Map(),
    signatures = new Map();
  const people = (r) =>
    [...(r.mine ? [t("You")] : []), ...r.names.slice(0, 12)].join(", ");
  const chipLabel = (r) =>
    labelled(t(r.label), `${r.count}${people(r) ? ` (${people(r)})` : ""}`);
  function chips(target, summary, interactive) {
    const data = escape(JSON.stringify(target));
    return summary
      .map((r) =>
        interactive
          ? `<button type="button" class="fac-reaction" data-fac-react="${r.type}" data-target="${data}" aria-pressed="${r.mine}" aria-label="${escape(chipLabel(r))}" title="${escape(chipLabel(r))}"><span aria-hidden="true">${r.emoji}</span> ${r.count}</button>`
          : `<span class="fac-reaction" role="img" aria-label="${escape(chipLabel(r))}" title="${escape(chipLabel(r))}"><span aria-hidden="true">${r.emoji}</span> ${r.count}</span>`,
      )
      .join("");
  }
  function addButton(target, nameId) {
    const label = nameId
      ? `aria-labelledby="${nameId}-reaction ${nameId}"`
      : `aria-label="${escape(t("Add a reaction"))}"`;
    return `<button type="button" class="fac-react-add" data-fac-picker="${escape(JSON.stringify(target))}" aria-haspopup="dialog" aria-expanded="false" title="${escape(t("Add a reaction"))}" ${label}>${nameId ? `<span class="sr-only" id="${nameId}-reaction">${escape(labelled(t("Add a reaction"), ""))}</span>` : ""}${ctx.icon("smile-plus")}</button>`;
  }
  function commentReactions(thread, message) {
    if (message.deleted) return "";
    const target = messageTarget(thread.id, message.id),
      summary = reactionSummary(
        ctx.index().get(targetKey(target)),
        ctx.me().id,
      ),
      interactive = ctx.canParticipate();
    if (!summary.length && !interactive) return "";
    return `<div class="fac-reactions" role="group" aria-label="${escape(t("Reactions"))}">${chips(target, summary, interactive)}${interactive ? addButton(target) : ""}</div>`;
  }
  function itemMarkup(i, state, nameId, nameHTML) {
    const parts = [`<span class="sr-only" id="${nameId}">${nameHTML}</span>`];
    if (state.private)
      parts.push(
        `<span class="fac-private" role="img" aria-label="${escape(t("Private note. Hidden until the facilitator reveals contributions."))}" title="${escape(t("Private note. Hidden until the facilitator reveals contributions."))}">${ctx.icon("eye-off")}</span>`,
      );
    if (state.staged)
      parts.push(
        `<span class="fac-staged">${ctx.icon("eye-off")}<span>${escape(t(state.staged))}</span></span>`,
      );
    if (state.count !== null)
      parts.push(
        `<span class="fac-vote-count" role="img" aria-label="${escape(counted("{count} votes", state.count).replace("{count}", state.count))}">${ctx.icon("vote")}${state.count}</span>`,
      );
    if (state.vote) {
      const { mine, canAdd, left } = state.vote;
      parts.push(
        `<button type="button" class="fac-vote-add" data-fac-vote="add" data-id="${escape(i.id)}" ${canAdd ? "" : 'aria-disabled="true"'} aria-labelledby="${nameId}-add ${nameId} ${nameId}-left"><span class="sr-only" id="${nameId}-add">${t("Vote for")}</span>${ctx.icon("plus")}<span aria-hidden="true">${t("Vote")}</span><span class="sr-only" id="${nameId}-left">· ${escape(counted("{count} votes left", left).replace("{count}", left))}</span></button>`,
      );
      if (mine)
        parts.push(
          `<button type="button" class="fac-vote-remove" data-fac-vote="remove" data-id="${escape(i.id)}" aria-labelledby="${nameId}-remove ${nameId} ${nameId}-mine"><span class="sr-only" id="${nameId}-remove">${t("Remove your vote from")}</span>${ctx.icon("minus")}<span aria-hidden="true">✓${mine}</span><span class="sr-only" id="${nameId}-mine">· ${escape(t("Your votes here: {count}").replace("{count}", mine))}</span></button>`,
        );
    }
    const target = objectTarget(i.id);
    parts.push(chips(target, state.reactions, state.interactive));
    if (state.add) parts.push(addButton(target, nameId));
    return parts.join("");
  }
  function render() {
    const board = ctx.board();
    if (!layer || !board) return;
    const view = ctx.view(),
      rect = ctx.canvas().getBoundingClientRect(),
      hidden = ctx.hidden(),
      selected = ctx.selection(),
      single = selected.size === 1 ? [...selected][0] : null,
      index = ctx.index(),
      concealed = ctx.concealment(),
      voting = ctx.voting(),
      interactive = ctx.canParticipate(),
      me = ctx.me().id,
      keep = new Set();
    let count = 0;
    // Boards without workshop state only need the selected object's button.
    const items =
      board.workshop || !single
        ? board.workshop
          ? board.items
          : []
        : board.items.filter((i) => i.id === single);
    for (let n = items.length - 1; n >= 0 && count < MAX_BADGES; n--) {
      const i = items[n];
      if (hidden?.has(i.id) || concealed.hidden.has(i.id)) continue;
      // Objects too small or out of view are skipped before their badge
      // state is worked out.
      if (
        single !== i.id &&
        Math.max(Math.abs(i.w), Math.abs(i.h)) * view.z < 24
      )
        continue;
      const box = objectBounds(i);
      const x = view.x + box.x * view.z + 6,
        y = view.y + (box.y + box.h) * view.z;
      if (x > rect.width || y < 0 || x + box.w * view.z < 0 || y > rect.height)
        continue;
      const records = index.get(targetKey(objectTarget(i.id)));
      const summary = records ? reactionSummary(records, me) : [];
      const target = voting?.targets.has(i.id);
      const state = {
        private: concealed.notes.has(i.id),
        staged: concealed.frames.has(i.id)
          ? "Hidden by the facilitator"
          : ctx.stagedForManager(i.id)
            ? "Hidden from participants"
            : "",
        count:
          target && voting.showCounts ? voting.counts.get(i.id) || 0 : null,
        vote:
          target && voting.open && interactive
            ? {
                mine: voting.mine.filter((id) => id === i.id).length,
                left: voting.left,
                canAdd:
                  voting.left > 0 &&
                  (voting.multiple || !voting.mine.includes(i.id)),
              }
            : null,
        reactions: summary,
        interactive,
        // Hidden while the object's text is edited, which it would cover.
        add:
          interactive &&
          single === i.id &&
          !concealed.notes.has(i.id) &&
          !ctx.editing?.(),
      };
      if (
        !state.private &&
        !state.staged &&
        state.count === null &&
        !state.vote &&
        !summary.length &&
        !state.add
      )
        continue;
      count++;
      keep.add(i.id);
      let node = nodes.get(i.id);
      if (!node) {
        node = document.createElement("div");
        node.className = "fac-item";
        node.id = `fac-object-${uid()}`;
        node.dataset.facItem = i.id;
        // Counts and reactions are read with the object they belong to.
        node.setAttribute("role", "group");
        layer.append(node);
        nodes.set(i.id, node);
      }
      const nameHTML = ctx.labelHTML?.(i.id) ?? escape(ctx.label(i.id));
      const signature = JSON.stringify([state, nameHTML, t("Vote")]);
      if (signatures.get(i.id) !== signature) {
        const focused = node.contains(document.activeElement)
          ? document.activeElement
          : null;
        const focusKey = focused && [
          focused.dataset.facVote,
          focused.dataset.facReact,
          focused.dataset.facPicker !== undefined,
        ];
        // An open reaction picker keeps its trigger when the badge is
        // redrawn, so Escape still returns focus to it.
        const opener =
          picker && node.contains(picker.trigger)
            ? picker.trigger.dataset.facPicker
            : null;
        signatures.set(i.id, signature);
        const nameId = `${node.id}-name`;
        node.setAttribute("aria-labelledby", nameId);
        node.innerHTML = itemMarkup(i, state, nameId, nameHTML);
        if (opener !== null) {
          const next = [...node.querySelectorAll("[data-fac-picker]")].find(
            (b) => b.dataset.facPicker === opener,
          );
          if (next) {
            picker.trigger = next;
            next.setAttribute("aria-expanded", "true");
          }
        }
        if (focusKey) {
          const buttons = [...node.querySelectorAll("button")];
          // A button that went, as when someone removed their reaction or
          // this person their last vote here, gives focus to the badge's
          // Vote or reaction button rather than the page.
          (
            buttons.find(
              (b) =>
                b.dataset.facVote === focusKey[0] &&
                b.dataset.facReact === focusKey[1] &&
                (b.dataset.facPicker !== undefined) === focusKey[2],
            ) ||
            node.querySelector('[data-fac-vote="add"]') ||
            node.querySelector("[data-fac-picker]") ||
            buttons[0] ||
            ctx.canvas()
          )?.focus({ preventScroll: true });
        }
      }
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
    }
    for (const [id, node] of nodes)
      if (!keep.has(id)) {
        if (node.contains(document.activeElement))
          ctx.canvas()?.focus({ preventScroll: true });
        node.remove();
        nodes.delete(id);
        signatures.delete(id);
      }
  }
  function closePicker(focus = true) {
    if (!picker) return;
    const { element } = picker;
    let { trigger } = picker;
    picker = null;
    element.remove();
    // A comment's reaction controls are rebuilt when anyone reacts or
    // votes; focus returns to the new button for the same message.
    if (!trigger.isConnected)
      trigger =
        [...document.querySelectorAll("[data-fac-picker]")].find(
          (b) => b.dataset.facPicker === trigger.dataset.facPicker,
        ) || trigger;
    trigger.setAttribute("aria-expanded", "false");
    if (focus && trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  function openPicker(trigger) {
    closePicker(false);
    const target = JSON.parse(trigger.dataset.facPicker);
    const mine = new Set(
      ctx
        .index()
        .get(targetKey(target))
        ?.find((r) => r.by === ctx.me().id)?.types || [],
    );
    const element = document.createElement("div");
    element.className = "fac-picker panel";
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", t("Add a reaction"));
    element.innerHTML = `<div role="group" aria-label="${escape(t("Reactions"))}">${REACTIONS.map(([type, emoji, label]) => `<button type="button" data-fac-choose="${type}" aria-pressed="${mine.has(type)}" aria-label="${escape(t(label))}" title="${escape(t(label))}"><span aria-hidden="true">${emoji}</span></button>`).join("")}</div>`;
    document.body.append(element);
    const r = trigger.getBoundingClientRect();
    const width = element.offsetWidth || 300,
      height = element.offsetHeight || 48;
    element.style.left = `${Math.max(8, Math.min(r.left, innerWidth - width - 8))}px`;
    element.style.top = `${r.bottom + height + 8 < innerHeight ? r.bottom + 6 : Math.max(8, r.top - height - 6)}px`;
    trigger.setAttribute("aria-expanded", "true");
    picker = { element, trigger, target };
    const buttons = [...element.querySelectorAll("button")];
    element.addEventListener("keydown", (e) => {
      e.stopPropagation();
      const at = buttons.indexOf(document.activeElement);
      if (e.key === "Escape") {
        e.preventDefault();
        closePicker();
      } else if (
        ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)
      ) {
        e.preventDefault();
        const step = ["ArrowRight", "ArrowDown"].includes(e.key) ? 1 : -1;
        buttons[(at + step + buttons.length) % buttons.length].focus();
      } else if (e.key === "Tab") {
        e.preventDefault();
        buttons[
          (at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length
        ].focus();
      }
    });
    element.addEventListener("click", (e) => {
      const button = e.target.closest("[data-fac-choose]");
      if (!button) return;
      const { target: chosen } = picker;
      closePicker();
      ctx.react(chosen, button.dataset.facChoose);
    });
    buttons[0].focus();
  }
  function click(e) {
    // Unavailable vote buttons stay focusable, so focus survives a vote.
    const vote = e.target.closest("[data-fac-vote]");
    if (vote?.getAttribute("aria-disabled") === "true") return;
    if (vote)
      return ctx.vote(vote.dataset.id, vote.dataset.facVote === "add" ? 1 : -1);
    const reaction = e.target.closest("[data-fac-react]");
    if (reaction)
      return ctx.react(
        JSON.parse(reaction.dataset.target),
        reaction.dataset.facReact,
      );
    const trigger = e.target.closest("[data-fac-picker]");
    if (trigger) {
      if (picker?.trigger === trigger) closePicker();
      else openPicker(trigger);
    }
  }
  // Comment messages render their reaction controls inside the comments panel.
  const documentClick = (e) => {
    if (
      picker &&
      !picker.element.contains(e.target) &&
      !e.target.closest("[data-fac-picker]")
    )
      closePicker(false);
    if (
      e.target.closest(
        "#comments-panel [data-fac-react], #comments-panel [data-fac-picker]",
      )
    )
      click(e);
  };
  function bind(host) {
    detach();
    layer = document.createElement("div");
    layer.id = "facilitation-badges";
    layer.className = "facilitation-badges";
    layer.setAttribute("role", "group");
    layer.setAttribute("aria-label", t("Reactions and votes"));
    layer.addEventListener("click", click);
    // Badges sit over the canvas; they must not start canvas gestures.
    for (const type of ["pointerdown", "dblclick", "wheel"])
      layer.addEventListener(type, (e) => {
        if (e.target !== layer) e.stopPropagation();
      });
    layer.addEventListener("keydown", (e) => {
      if (e.target !== layer) e.stopPropagation();
    });
    host.append(layer);
    document.addEventListener("click", documentClick);
  }
  function detach() {
    closePicker(false);
    layer?.remove();
    layer = null;
    nodes.clear();
    signatures.clear();
    document.removeEventListener("click", documentClick);
  }
  return { bind, detach, render, commentReactions, closePicker };
}
