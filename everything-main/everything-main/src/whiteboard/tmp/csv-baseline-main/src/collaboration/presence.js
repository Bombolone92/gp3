import { t } from "../i18n.js";
const colors = [
  "#a331b0",
  "#116baf",
  "#bc4b12",
  "#13794b",
  "#9f3656",
  "#6252b5",
];
export function color(id) {
  return colors[
    [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0) %
      colors.length
  ];
}
export class PresenceLayer {
  constructor(wrap) {
    this.layer = document.createElement("div");
    this.layer.className = "collaboration-overlay";
    this.layer.setAttribute("aria-hidden", "true");
    wrap.append(this.layer);
    this.nodes = new Map();
  }
  render(people, items, view, self, showCursors = true) {
    const keep = new Set();
    // Most draws have no one else selecting anything, so the objects are
    // looked up only when someone is.
    let byId = null;
    const lookup = (id) =>
      (byId ??= new Map(items.map((item) => [item.id, item]))).get(id);
    const viewport = this.layer.getBoundingClientRect();
    for (const [session, person] of people) {
      if (session === self) continue;
      const make = (key, className) => {
        keep.add(key);
        let node = this.nodes.get(key);
        if (!node) {
          node = document.createElement("div");
          node.className = className;
          node.dataset.userContent = "";
          this.nodes.set(key, node);
          this.layer.append(node);
        }
        const tint = color(person.user);
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
        write(cursor, "↖ " + person.username);
        const at = `translate(${view.x + person.cursor.x * view.z}px, ${view.y + person.cursor.y * view.z}px)`;
        if (cursor.style.transform !== at) cursor.style.transform = at;
      }
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
        const box = make(`${session}:${id}`, "participant-selection");
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
        // The name sits on a tag of the person's color, readable over any
        // object and on either theme's canvas.
        const label =
          box.firstElementChild ||
          box.appendChild(document.createElement("span"));
        write(
          label,
          person.username + (person.editing === id ? " · " + t("Editing") : ""),
        );
      }
    }
    for (const [id, node] of this.nodes)
      if (!keep.has(id)) {
        node.remove();
        this.nodes.delete(id);
      }
  }
  close() {
    this.layer.remove();
    this.nodes.clear();
  }
}
