import { t } from "../i18n.js";
// Fifteen hues far enough apart to tell people apart in a group, each dark
// enough for white text (4.5:1) and visible on the dark theme's canvas.
const colors = [
  "#c62828",
  "#bf360c",
  "#b45309",
  "#8d6e00",
  "#4d7c0f",
  "#2e7d32",
  "#047857",
  "#00838f",
  "#0277bd",
  "#1d4ed8",
  "#5c6bc0",
  "#6252b5",
  "#a331b0",
  "#d81b60",
  "#9f3656",
];
export function color(id) {
  return colors[
    [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0) %
      colors.length
  ];
}
// How often a person's presence is sent (session.js): less often as a room
// grows. Others' cursors glide over that time.
export const presenceInterval = (people) =>
  people > 30 ? 200 : people > 8 ? 100 : 40;
// How long a cursor rests before its name folds away.
const IDLE = 4000;
// An outline that no longer carries a name tag.
function unname(box) {
  box.firstElementChild?.remove();
  if (box.classList.contains("is-named")) box.classList.remove("is-named");
}
export class PresenceLayer {
  constructor(wrap) {
    this.layer = document.createElement("div");
    this.layer.className = "collaboration-overlay";
    this.layer.setAttribute("aria-hidden", "true");
    wrap.append(this.layer);
    this.nodes = new Map();
    // Where each cursor last moved on the board, and when.
    this.moved = new Map();
  }
  render(people, items, view, self, showCursors = true, room = people.size) {
    const keep = new Set();
    // Cursors glide over the time between two of a person's samples, which
    // grows with the room (session.js), and jump with this view as it pans
    // or zooms rather than trail behind the board.
    const glide = `${presenceInterval(room)}ms`;
    if (this.glide !== glide) {
      this.glide = glide;
      this.layer.style.setProperty("--cursor-glide", glide);
    }
    const place = `${view.x}|${view.y}|${view.z}`,
      panning = this.view !== undefined && this.view !== place;
    this.view = place;
    if (this.layer.classList.contains("is-panning") !== panning)
      this.layer.classList.toggle("is-panning", panning);
    // Most draws have no one else selecting anything, so the objects are
    // looked up only when someone is.
    let byId = null;
    const lookup = (id) =>
      (byId ??= new Map(items.map((item) => [item.id, item]))).get(id);
    const viewport = this.layer.getBoundingClientRect();
    // The names to show on each object, gathered from everyone first.
    const named = new Map();
    for (const [session, person] of people) {
      if (session === self) continue;
      // Nodes are keyed by who the person appears as as well, so turning
      // anonymous input on or off replaces their cursor and outlines rather
      // than renaming them in place, where they could be followed across.
      const make = (key, className, user = person.user) => {
        key = `${key}\n${user}`;
        keep.add(key);
        let node = this.nodes.get(key);
        if (!node) {
          node = document.createElement("div");
          node.className = className;
          node.dataset.userContent = "";
          this.nodes.set(key, node);
          this.layer.append(node);
        }
        const tint = color(user);
        if (node.dataset.tint !== tint) {
          node.dataset.tint = tint;
          node.style.setProperty("--participant", tint);
        }
        return node;
      };
      // Text and positions are written only when they change, as this runs
      // on every draw.
      const write = (node, text) => {
        if (node.textContent !== text) node.textContent = text;
      };
      if (
        showCursors &&
        person.cursor &&
        (!viewport.width ||
          (view.x + person.cursor.x * view.z >= 0 &&
            view.x + person.cursor.x * view.z <= viewport.width &&
            view.y + person.cursor.y * view.z >= 0 &&
            view.y + person.cursor.y * view.z <= viewport.height))
      ) {
        const cursor = make(session, "participant-cursor");
        // An arrow in the person's colour at the point itself, and their
        // name beside it, as on the person's own screen.
        if (!cursor.firstElementChild)
          cursor.innerHTML =
            '<svg viewBox="0 0 16 18" width="16" height="18" aria-hidden="true"><path d="M1.5 1.5v13l3.6-3.4 2.5 5.4 2.4-1.1-2.5-5.3h5z"/></svg><span></span>';
        write(cursor.lastElementChild, person.username);
        const at = `translate(${view.x + person.cursor.x * view.z}px, ${view.y + person.cursor.y * view.z}px)`;
        if (cursor.style.transform !== at) cursor.style.transform = at;
        // A cursor resting for a few seconds folds its name away, so a room
        // of people reading the board stays readable; moving brings it back.
        const last = this.moved.get(session),
          now = Date.now();
        if (
          last?.x !== person.cursor.x ||
          last?.y !== person.cursor.y ||
          last?.user !== person.user
        )
          this.moved.set(session, {
            ...person.cursor,
            user: person.user,
            at: now,
          });
        const idle = now - (this.moved.get(session).at || now) > IDLE;
        if (cursor.classList.contains("is-idle") !== idle)
          cursor.classList.toggle("is-idle", idle);
      }
      // Objects whose author was anonymous are outlined as a participant's,
      // apart from the person's named outlines.
      const unnamed = person.unnamed;
      const boxes = [];
      for (const id of person.selection || []) {
        const item = lookup(id);
        if (!item) continue;
        const geometry = person.preview?.find((p) => p.id === id) || item;
        const left =
            view.x + Math.min(geometry.x, geometry.x + geometry.w) * view.z,
          top = view.y + Math.min(geometry.y, geometry.y + geometry.h) * view.z,
          width = Math.abs(geometry.w) * view.z,
          height = Math.abs(geometry.h) * view.z;
        // Outlines out of view are left out, as cursors are. A rotated box
        // reaches at most its diagonal beyond its corner.
        const reach = Math.hypot(width, height);
        if (
          viewport.width &&
          (left + reach < 0 ||
            top + reach < 0 ||
            left - reach > viewport.width ||
            top - reach > viewport.height)
        )
          continue;
        const hidden = !!unnamed?.ids.includes(id);
        const box = make(
          `${session}:${id}`,
          "participant-selection",
          hidden ? unnamed.user : person.user,
        );
        const place = `${left}|${top}|${width}|${height}|${geometry.rotation || 0}`;
        if (box.dataset.place !== place) {
          box.dataset.place = place;
          Object.assign(box.style, {
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
            transform: `rotate(${geometry.rotation || 0}deg)`,
          });
        }
        boxes.push([id, box, hidden]);
      }
      // One name per person, as in Miro, on a tag of their colour readable
      // over any object and on either theme's canvas: on what they are
      // editing, or else on the first of their objects in view.
      for (const hidden of unnamed ? [false, true] : [false]) {
        const group = boxes.filter((box) => box[2] === hidden);
        const chosen = group.find(([id]) => id === person.editing) || group[0];
        for (const [, box] of group) if (box !== chosen?.[1]) unname(box);
        if (chosen) {
          const [id, box] = chosen;
          if (!named.has(id)) named.set(id, []);
          named.get(id).push({
            box,
            editing: person.editing === id,
            name: hidden ? t("Participant") : person.username,
          });
        }
      }
    }
    // Several people on one object share one tag rather than cover each
    // other's at the same spot: whoever is editing first, in their colour
    // and above the other outlines, then the others, a few by name.
    for (const entries of named.values()) {
      entries.sort((a, b) => b.editing - a.editing);
      const [first, ...rest] = entries;
      for (const { box } of rest) unname(box);
      const text =
        entries
          .slice(0, 3)
          .map(
            ({ name, editing }) => name + (editing ? " · " + t("Editing") : ""),
          )
          .join(", ") + (entries.length > 3 ? ` +${entries.length - 3}` : "");
      const label =
        first.box.firstElementChild ||
        first.box.appendChild(document.createElement("span"));
      if (label.textContent !== text) label.textContent = text;
      if (!first.box.classList.contains("is-named"))
        first.box.classList.add("is-named");
    }
    for (const [id, node] of this.nodes)
      if (!keep.has(id)) {
        node.remove();
        this.nodes.delete(id);
      }
    for (const session of this.moved.keys())
      if (!people.has(session)) this.moved.delete(session);
  }
  close() {
    this.layer.remove();
    this.nodes.clear();
  }
}
