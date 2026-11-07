import { board, item, validateBoard } from "../src/model.js";
import { openTasksDialog } from "../src/planning/tasks-dialog.js";
import { setLanguage, translateUI } from "../src/i18n.js";
import "../src/planning/planning.css";
import "../src/style.css";
const plan = board("Local planning layout fixture");
const text = "Veuillez discuter les prochaines étapes. Read first.",
  frame = item("frame", 0, 0, { text, lang: "fr-CA", w: 800, h: 600, textRuns: [{ start: text.indexOf("Read"), end: text.length, style: { lang: "en-CA" } }] });
const phrase = "Veuillez choisir les prochaines étapes. Read first.",
  task = item("note", 20, 80, { text: phrase + " Merci de lire attentivement.".repeat(30), lang: "fr-CA", textRuns: [{ start: phrase.indexOf("Read"), end: phrase.length, style: { lang: "en-CA" } }], parentId: frame.id, task: { status: "todo", start: "2026-10-01", due: "2026-10-02" } }),
  prerequisite = item("note", 250, 80, { text: "Por favor prepare el informe. Bonjour à tous.", lang: "es", textRuns: [{ start: "Por favor prepare el informe. ".length, end: "Por favor prepare el informe. Bonjour à tous.".length, style: { lang: "fr-CA" } }], parentId: frame.id, task: { status: "todo", start: "2026-10-01", due: "2026-10-02" } });
plan.items = [frame, task, prerequisite, item("arrow", 190, 80, { startId: prerequisite.id, endId: task.id, dependency: "blocks" })];
validateBoard(plan);
const pageLanguage = new URLSearchParams(location.search).get("lang") === "fr" ? "fr" : "en";
setLanguage(pageLanguage); document.documentElement.lang = pageLanguage;
document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
let currentDialog;
const update = () => {
  const table = [...(currentDialog?.querySelectorAll('.task-table-wrap') || [])].find(el => !el.closest('[hidden]'));
  const preview = currentDialog?.querySelector('#tasks-title-preview');
  const focus = document.activeElement;
  const description = `table=${table ? Math.round(table.scrollLeft) + '/' + (table.scrollWidth - table.clientWidth) : 'none'}; preview=${preview && !preview.hidden ? Math.round(preview.scrollTop) + '/' + (preview.scrollHeight - preview.clientHeight) : 'hidden'}; focus=${focus?.id || focus?.className || focus?.tagName}; viewport=${innerWidth}x${innerHeight}; previewBox=${preview && !preview.hidden ? [preview.offsetWidth,preview.offsetHeight,Math.round(preview.getBoundingClientRect().left),Math.round(preview.getBoundingClientRect().top)].join(",") : "none"}`;
  parent.postMessage({audit:'task-planning',description}, location.origin);
};
function open() {
  openTasksDialog({
    board: () => plan, now: () => Date.parse("2026-09-30T12:00:00"),
    canAdd: () => false, canPlan: () => false, selectedTasks: () => [],
    jira: { status: () => ({ available: false, message: "" }) },
    modal(title, html, ready) {
      const dialog = document.createElement("dialog"); dialog.setAttribute("aria-label", title);
      dialog.innerHTML = `<div class="dialog-header"><h2>${title}</h2><button type="button">${pageLanguage === "fr" ? "Fermer" : "Close"}</button></div>${html}`;
      currentDialog = dialog;
      dialog.addEventListener('focusin',update);
      dialog.addEventListener('scroll',() => requestAnimationFrame(update),true);
      new MutationObserver(() => requestAnimationFrame(update)).observe(dialog,{subtree:true,attributes:true,attributeFilter:['hidden'],childList:true});
      document.body.append(dialog); dialog.querySelector(".dialog-header button").onclick = () => dialog.close();
      dialog.addEventListener("close", () => dialog.remove()); dialog.showModal(); ready(dialog); translateUI(dialog); requestAnimationFrame(update); return dialog;
    },
    focusObject() {}, placeTimeline() {}, setStatusSync() {}, download() {},
  });
}
document.querySelector("#open").onclick = open; open();

addEventListener("resize",()=>requestAnimationFrame(update));
