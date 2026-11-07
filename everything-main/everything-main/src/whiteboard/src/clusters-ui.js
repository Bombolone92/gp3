import { bounds } from "./model.js";
import { language, plural, t } from "./i18n.js";
import { planClusters, applyClusters } from "./clusters.js";
import { keepPageFocus } from "./paging.js";
import { authoredTextHTML } from "./accessibility/object-content.js";
import {
  createAuthoredField,
  trimmedFieldContent,
} from "./facilitation/authored-field.js";

export function openClusters(api) {
  const board = api.board(),
    ids = new Set(
      board.items
        .filter((i) => api.selection().has(i.id) && i.type === "note")
        .map((i) => i.id),
    );
  if (!ids.size) return api.toast("Select sticky notes first.");
  if (!api.canEdit(ids)) return;
  api.modal(
    "Cluster sticky notes",
    `<form id="cluster-form"><label class="field">Cluster by<select id="cluster-mode"><option value="color">Color</option><option value="tag">Tag</option><option value="one">One named cluster</option></select></label><div class="field" id="cluster-name-field" hidden><span id="cluster-name-label">Cluster name</span><div id="cluster-name"></div></div><p class="dialog-copy">Selected notes move into editable frames. Notes leave their previous groups and frames; other objects stay in place. Notes with several tags are copied into each matching cluster.</p><p id="cluster-summary" role="status" aria-live="polite"></p><ul id="cluster-preview" class="cluster-preview" tabindex="0" aria-label="Cluster preview"></ul><div class="cluster-pages"><button type="button" class="text-btn" id="cluster-prev">Previous</button><span id="cluster-page"></span><button type="button" class="text-btn" id="cluster-next">Next</button></div><p id="cluster-error" role="alert" hidden></p><div class="dialog-footer"><button type="button" class="secondary" id="cluster-cancel">Cancel</button><button class="primary" id="cluster-apply">Create clusters</button></div></form>`,
    (d) => {
      let plan,
        page = 0;
      const mode = d.querySelector("#cluster-mode"),
        name = createAuthoredField(
          d.querySelector("#cluster-name"),
          { text: t("Cluster"), lang: language },
          { maxLength: 200, multiline: false },
        ),
        error = d.querySelector("#cluster-error");
      d.addEventListener("close", () => name.destroy(), { once: true });
      const make = () => {
        const titleContent = trimmedFieldContent(name);
        return planClusters(board, ids, mode.value, titleContent.text, {
          language,
          titleContent,
          noTag: t("No tag"),
          color: t("Color"),
          palette: ["Butter", "Sage", "Blue", "Lilac", "Peach", "White"].map(t),
        });
      };
      const showError = (message) => {
        error.hidden = false;
        error.textContent = t(message);
      };
      function preview() {
        const groups = plan?.groups || [];
        page = Math.min(page, Math.max(0, Math.ceil(groups.length / 50) - 1));
        d.querySelector("#cluster-preview").innerHTML = groups
          .slice(page * 50, page * 50 + 50)
          .map(
            (g) =>
              `<li><span class="tag-swatch" style="background:${g.color}" aria-hidden="true"></span><span data-user-content>${authoredTextHTML({ text: g.title, lang: g.lang, textRuns: g.textRuns })}</span><span>${g.members.length}</span></li>`,
          )
          .join("");
        d.querySelector(".cluster-pages").hidden = groups.length <= 50;
        d.querySelector("#cluster-prev").disabled = page === 0;
        d.querySelector("#cluster-next").disabled =
          (page + 1) * 50 >= groups.length;
        d.querySelector("#cluster-page").textContent =
          `${page + 1} / ${Math.max(1, Math.ceil(groups.length / 50))}`;
        d.querySelector("#cluster-summary").textContent = plan
          ? `${plural(plan.count, "{count} note", "{count} notes")} · ${plural(groups.length, "{count} cluster", "{count} clusters")} · ${plural(plan.copies, "{count} extra copy", "{count} extra copies")}`
          : "";
        d.querySelector("#cluster-apply").disabled = !plan;
      }
      function refresh() {
        d.querySelector("#cluster-name-field").hidden = mode.value !== "one";
        error.hidden = true;
        try {
          plan = make();
        } catch (e) {
          plan = null;
          showError(e.message);
        }
        preview();
      }
      mode.onchange = () => {
        page = 0;
        refresh();
      };
      name.oninput = refresh;
      name.languageControls.addEventListener("click", (event) => {
        if (event.target.closest("#cluster-name-language-save")) refresh();
      });
      const previous = d.querySelector("#cluster-prev"),
        next = d.querySelector("#cluster-next");
      previous.onclick = () => {
        page--;
        preview();
        keepPageFocus(previous, next);
      };
      next.onclick = () => {
        page++;
        preview();
        keepPageFocus(next, previous);
      };
      d.querySelector("#cluster-cancel").onclick = () => d.close();
      d.querySelector("#cluster-form").onsubmit = (e) => {
        e.preventDefault();
        if (e.isComposing || api.board() !== board || !api.canEdit(ids)) return;
        try {
          const latest = make();
          if (!plan || latest.signature !== plan.signature) {
            plan = latest;
            preview();
            return showError(
              "The notes changed. Review the updated clusters and try again.",
            );
          }
          // Plan against current metadata; apply uses current text/styles, retaining
          // collaborators' content changes that do not affect this arrangement.
          let frames;
          api.mutate(() => {
            frames = applyClusters(board, latest);
            api.select(frames);
          });
          d.close();
          api.focusClusters?.(
            bounds(board.items.filter((i) => frames.has(i.id))),
          );
        } catch (e) {
          refresh();
          showError(e.message);
        }
      };
      refresh();
    },
  );
}
