import { selectionFilters } from "./selection-filter.js";
import { t, translateUI } from "./i18n.js";

export function openSelectionFilter(api) {
  const board = api.board(),
    ids = new Set(api.selection()),
    withinGroup = api.focusedGroup?.(),
    options = withinGroup ? api.selectionOptions?.() : undefined;
  if (!board) return;
  let plan = selectionFilters(board.items, ids, options);
  if (!plan.choices.length) return api.toast("Select objects first.");
  api.modal(
    "Filter selection",
    `<p class="dialog-copy">Choose the object type to keep selected.</p><div id="selection-filter-choices" class="selection-filter-choices"></div><p id="selection-filter-hint" class="dialog-copy">Groups stay together. Frames keep their contents; mind map nodes keep their branches.</p><p id="selection-filter-status" role="status" aria-live="polite"></p><div class="dialog-footer"><button class="secondary" id="selection-filter-cancel">Cancel</button></div>`,
    (d) => {
      const list = d.querySelector("#selection-filter-choices");
      function render() {
        list.replaceChildren();
        for (const choice of plan.choices) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "secondary";
          button.dataset.selectionType = choice.key;
          const label = document.createElement("span"),
            count = document.createElement("span");
          label.textContent = t(choice.label);
          count.textContent = String(choice.count);
          count.className = "selection-filter-count";
          button.append(label, count);
          button.onclick = () => {
            if (api.board() !== board) return d.close();
            const latest = selectionFilters(board.items, ids, options);
            if (latest.signature !== plan.signature) {
              plan = latest;
              render();
              d.querySelector("#selection-filter-status").textContent = t(
                plan.choices.length
                  ? "The selection changed. Choose a type again."
                  : "These objects are no longer on the board.",
              );
              (
                list.querySelector("button") ||
                d.querySelector("#selection-filter-cancel")
              ).focus();
              return;
            }
            api.select(choice.seeds, { withinGroup });
            d.close();
            api.draw();
            document.querySelector("#canvas")?.focus({ preventScroll: true });
          };
          list.append(button);
        }
        d.querySelector("#selection-filter-hint").hidden = !plan.choices.some(
          (c) => ["group", "frame", "mind"].includes(c.key),
        );
        translateUI(list);
      }
      render();
      d.querySelector("#selection-filter-cancel").onclick = () => d.close();
      list.querySelector("button")?.focus();
    },
  );
}
