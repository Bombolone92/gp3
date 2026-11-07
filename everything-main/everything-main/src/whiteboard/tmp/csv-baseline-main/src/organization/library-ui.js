import { escape } from "../model.js";
import { busy } from "../accessibility/busy.js";
import { addTranslations, t, language } from "../i18n.js";
import { authoredTextHTML } from "../accessibility/object-content.js";
import {
  createAuthoredField,
  trimmedFieldContent,
} from "../facilitation/authored-field.js";

// The organization library: templates members share, which administrators
// approve before everyone sees them. Using one makes a new board from it.
export function createOrganizationLibrary({
  org,
  modal,
  toast,
  icon,
  refresh = () => {},
  useBoard,
  shareable,
}) {
  const date = (at) =>
    at
      ? new Date(at).toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "";
  // Categories the app fills in are saved in English and shown in the
  // reader's language; ones people type stay as written.
  const DEFAULT_CATEGORIES = new Set(["General", "Migrated from Miro"]);
  const category = (value) =>
    DEFAULT_CATEGORIES.has(value)
      ? `<span>${escape(t(value))}</span>`
      : `<span data-user-content>${escape(value)}</span>`;
  function open() {
    modal(
      "Organization library",
      `<p class="dialog-copy">${t("Templates shared across your organization. Content a member shares appears for everyone once an administrator approves it.")}</p><label class="search">${icon("search")}<input id="org-library-search" type="search" aria-label="${t("Search the library")}" placeholder="${t("Search the library")}" autocomplete="off"></label><p id="org-library-status" class="dialog-copy" role="status">${t("Loading…")}</p><div id="org-library-list" class="org-library-list"></div>`,
      (d) => {
        const list = d.querySelector("#org-library-list"),
          status = d.querySelector("#org-library-status"),
          search = d.querySelector("#org-library-search");
        let items = [],
          canPublish = false;
        const render = () => {
          const query = search.value.trim().toLowerCase();
          const shown = items.filter((i) =>
            [
              i.name,
              i.description,
              i.category,
              DEFAULT_CATEGORIES.has(i.category) ? t(i.category) : "",
              i.createdByName,
            ]
              .join(" ")
              .toLowerCase()
              .includes(query),
          );
          status.textContent = !items.length
            ? t("Nothing has been shared to the library yet.")
            : shown.length
              ? `${shown.length} ${t(shown.length === 1 ? "item" : "items")}`
              : t("No library items match your search.");
          list.innerHTML = shown
            .map((i) => {
              const pending = i.status !== "approved";
              return `<div class="revision-row" data-item="${escape(i.id)}"><div><strong data-user-content>${escape(i.name)}</strong><small>${category(i.category)} · ${t("Shared by")} <span data-user-content>${escape(i.createdByName || "")}</span> · ${escape(date(i.created))}${pending ? ` · <span class="badge">${t("Awaiting approval")}</span>` : ""}</small>${i.description ? `<small data-user-content>${authoredTextHTML({ text: i.description, lang: i.descriptionLang, textRuns: i.descriptionRuns })}</small>` : ""}</div><button type="button" class="secondary" data-library-use>${t("Use template")}</button>${pending && canPublish ? `<button type="button" class="secondary" data-library-approve>${t("Approve")}</button>` : ""}${i.canRemove ? `<button type="button" class="text-btn" data-library-remove>${t("Remove")}</button>` : ""}</div>`;
            })
            .join("");
          refresh();
        };
        const load = async () => {
          try {
            const result = await org.request("library.list");
            if (!d.isConnected) return;
            canPublish = !!result.canPublish;
            // Items awaiting approval come first for administrators.
            items = (result.items || []).sort(
              (a, b) =>
                (a.status === "approved") - (b.status === "approved") ||
                (b.created || 0) - (a.created || 0),
            );
            render();
          } catch (error) {
            if (d.isConnected) status.textContent = t(error.message);
          }
        };
        search.oninput = render;
        list.addEventListener("click", async (e) => {
          const button = e.target.closest("button");
          const row = button?.closest("[data-item]");
          if (!row || button.disabled) return;
          const item = items.find((i) => i.id === row.dataset.item);
          if (!item) return;
          if (
            button.matches("[data-library-remove]") &&
            !button.dataset.confirm
          ) {
            // Removing has no undo, so it takes a second press.
            button.dataset.confirm = "true";
            button.textContent = t("Confirm removal");
            button.classList.add("danger");
            return;
          }
          const done = busy(button);
          try {
            if (button.matches("[data-library-use]")) {
              const { board } = await org.request("library.get", {
                id: item.id,
              });
              await useBoard(board, item.name);
              d.close();
            } else if (button.matches("[data-library-approve]")) {
              await org.request("library.approve", { id: item.id });
              item.status = "approved";
              toast("Approved for everyone in the organization.");
              render();
              list
                .querySelector(`[data-item="${CSS.escape(item.id)}"] button`)
                ?.focus();
            } else {
              await org.request("library.remove", { id: item.id });
              items = items.filter((i) => i !== item);
              toast("Removed from the library.");
              render();
              search.focus();
            }
          } catch (error) {
            toast(error.message);
          } finally {
            if (button.isConnected) done();
          }
        });
        search.focus();
        load();
      },
    );
  }
  // Shares the open board as a template.
  function share() {
    const board = shareable();
    if (!board) return toast("Open a board to share it.");
    modal(
      "Share to organization library",
      `<form id="org-library-share"><p class="dialog-copy">${t(org.isAdmin ? "Everyone in your organization can use it right away." : "An administrator approves it before others see it.")}</p><label class="field">${t("Name")}<input id="org-library-name" required maxlength="120" value="${escape(board.title)}"></label><label class="field">${t("Category")}<input id="org-library-category" maxlength="60" placeholder="${t("General")}"></label><div class="field"><span id="org-library-description-label">${t("Description (optional)")}</span><div id="org-library-description"></div></div><div class="dialog-footer"><button class="primary">${t("Share template")}</button></div></form>`,
      (d) => {
        const form = d.querySelector("form");
        const description = createAuthoredField(
          d.querySelector("#org-library-description"),
          { text: "", lang: language },
          { maxLength: 500 },
        );
        description.style.minHeight = "3em";
        d.addEventListener("close", () => description.destroy(), {
          once: true,
        });
        d.querySelector("#org-library-name").select();
        form.onsubmit = async (e) => {
          e.preventDefault();
          const button = form.querySelector(".primary");
          if (button.disabled) return;
          const done = busy(button);
          try {
            const content = trimmedFieldContent(description);
            const { item } = await org.request("library.submit", {
              name: d.querySelector("#org-library-name").value.trim(),
              category:
                d.querySelector("#org-library-category").value.trim() ||
                "General",
              description: content.text,
              ...(content.text && content.lang
                ? { descriptionLang: content.lang }
                : {}),
              ...(content.textRuns?.length
                ? { descriptionRuns: content.textRuns }
                : {}),
              board: JSON.stringify(board),
            });
            description.destroy();
            d.close();
            toast(
              item.status === "approved"
                ? "Shared to the organization library."
                : "Shared. An administrator will review it.",
            );
          } catch (error) {
            toast(error.message);
          } finally {
            done();
          }
        };
      },
    );
  }
  return { open, share };
}

addTranslations({
  "Templates shared across your organization. Content a member shares appears for everyone once an administrator approves it.":
    "Modèles partagés dans votre organisation. Le contenu partagé par un membre apparaît pour tous une fois approuvé par un administrateur.",
  "Search the library": "Rechercher dans la bibliothèque",
  "Nothing has been shared to the library yet.":
    "Rien n’a encore été partagé dans la bibliothèque.",
  "No library items match your search.":
    "Aucun élément de la bibliothèque ne correspond à votre recherche.",
  item: "élément",
  items: "éléments",
  "Shared by": "Partagé par",
  "Awaiting approval": "En attente d’approbation",
  Approve: "Approuver",
  "Confirm removal": "Confirmer le retrait",
  "Approved for everyone in the organization.":
    "Approuvé pour toute l’organisation.",
  "Removed from the library.": "Retiré de la bibliothèque.",
  "Open a board to share it.": "Ouvrez un tableau pour le partager.",
  "Share to organization library":
    "Partager dans la bibliothèque de l’organisation",
  "Everyone in your organization can use it right away.":
    "Toute votre organisation peut l’utiliser immédiatement.",
  "An administrator approves it before others see it.":
    "Un administrateur l’approuve avant que d’autres le voient.",
  General: "Général",
  "Migrated from Miro": "Migré depuis Miro",
  "Description (optional)": "Description (facultative)",
  "Share template": "Partager le modèle",
  "Shared to the organization library.":
    "Partagé dans la bibliothèque de l’organisation.",
  "Shared. An administrator will review it.":
    "Partagé. Un administrateur l’examinera.",
});
