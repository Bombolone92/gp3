import "../src/style.css";
import "../src/organization/organization.css";
import { createAdminConsole } from "../src/organization/admin-ui.js";
import { createOrganizationLibrary } from "../src/organization/library-ui.js";
import { setLanguage, t, translateUI } from "../src/i18n.js";
import { scaleOrganization } from "./scale-organization.js";
import { paint } from "../src/render.js";
import { bounds, zoomAt } from "../src/model.js";

const sample = await (await fetch(document.body.dataset.sample)).json();
const org = scaleOrganization(sample);
const controls = document.querySelector("#scale-controls");
const notify = document.querySelector("#scale-notice");
const toast = (message) => {
  notify.textContent = t(message);
};
const refresh = () => {
  const d = document.querySelector("dialog[open]");
  if (d) translateUI(d);
};
function modal(title, html, ready) {
  const previous = document.querySelector("dialog");
  if (previous?.open) previous.close();
  previous?.remove();
  const d = document.createElement("dialog");
  d.setAttribute("aria-labelledby", "sample-dialog-title");
  const heading = document.createElement("h2");
  heading.id = "sample-dialog-title";
  heading.textContent = t(title);
  d.append(heading);
  d.insertAdjacentHTML("beforeend", html);
  document.body.append(d);
  queueMicrotask(() => {
    ready?.(d);
    d.showModal();
    refresh();
  });
  return d;
}
const download = (body, name, type) => {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const canvas = document.querySelector("#sample-canvas");
let current = sample.workshop,
  view = { x: 12, y: 12, z: 0.2 },
  pointer = null;
const repaint = () => paint(canvas, current.items, view, { grid: "dots" });
const fit = () => {
  const box = bounds(current.items),
    rect = canvas.getBoundingClientRect();
  const z = Math.min((rect.width - 24) / box.w, (rect.height - 24) / box.h, 1);
  view = {
    x: (rect.width - box.w * z) / 2 - box.x * z,
    y: (rect.height - box.h * z) / 2 - box.y * z,
    z,
  };
  repaint();
};
function showBoard(value, name) {
  current = typeof value === "string" ? JSON.parse(value) : value;
  document.querySelector("#sample-board-title").textContent =
    name || current.title;
  fit();
  toast(`${current.items.length} sample objects. Drag to pan; scroll to zoom.`);
}
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    view = zoomAt(
      view,
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      Math.max(0.01, Math.min(4, view.z * Math.exp(-e.deltaY / 400))),
    );
    repaint();
  },
  { passive: false },
);
canvas.onpointerdown = (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove = (e) => {
  if (!pointer) return;
  view.x += e.clientX - pointer.x;
  view.y += e.clientY - pointer.y;
  pointer = { x: e.clientX, y: e.clientY };
  repaint();
};
canvas.onpointerup = canvas.onpointercancel = () => {
  pointer = null;
};
const admin = createAdminConsole({
  org,
  modal,
  toast,
  icon: () => "",
  refresh,
  download,
  openBoard: async (room) =>
    showBoard(
      sample.workshop,
      sample.boards.find((b) => b.room === room)?.title,
    ),
});
const library = createOrganizationLibrary({
  org,
  modal,
  toast,
  icon: () => "",
  refresh,
  useBoard: async (value, name) => showBoard(value, name),
  shareable: () => current,
});
for (const [label, action] of [
  ["Open sample directory", () => admin.open("people")],
  ["Boards and activity", () => admin.open("boards")],
  ["Reports", () => admin.open("overview")],
  ["Audit log", () => admin.open("audit")],
  ["Organization library", () => library.open()],
  [
    "English",
    () => {
      setLanguage("en");
      admin.open("people");
    },
  ],
  [
    "French",
    () => {
      setLanguage("fr");
      admin.open("people");
    },
  ],
  [
    "Toggle theme",
    () => {
      document.documentElement.dataset.theme =
        document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      repaint();
    },
  ],
  ["Fit workshop", () => showBoard(sample.workshop)],
]) {
  const button = document.createElement("button");
  button.className = "secondary";
  button.textContent = label;
  button.onclick = action;
  controls.append(button);
}
new ResizeObserver(repaint).observe(canvas);
showBoard(sample.workshop);
