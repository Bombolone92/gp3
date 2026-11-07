import { escape } from "../src/model.js";
import { addTranslations, t, language } from "../src/i18n.js";
import { downscaleDataURL } from "../src/ai/ai-ui.js";
import { languageAttribute } from "../src/accessibility/object-content.js";

function suggestionText(text) {
  const value = text.trim().replace(/^"|"$/g, "");
  let end = Math.min(1000, value.length);
  const previous = value.charCodeAt(end - 1), next = value.charCodeAt(end);
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
  return value.slice(0, end);
}

// Alternative text for images and drawings: read by screen readers through the board
// outline and object list, searchable, and kept in exports that support it.
export function createAltText({ board, modal, mutate, toast, ai, canEdit }) {
  return {
    open(image) {
      if (!image || !["image", "pen"].includes(image.type)) return;
      if (!canEdit(new Set([image.id]))) return;
      const drawing = image.type === "pen",
        blocked = drawing || ai?.availability("summaries");
      // The character count describes the field without being part of its
      // name or announced on every keystroke.
      modal(
        "Alternative text",
        `<form id="alt-form"><p class="dialog-copy">${t(drawing ? "Describe what the drawing shows and why it matters on this board. Leave it empty for purely decorative drawings." : "Describe what the image shows and why it matters on this board. Leave it empty for purely decorative images.")}</p><label class="field">${t("Alternative text")}<textarea id="alt-text"${languageAttribute(image.lang)} rows="4" maxlength="1000" aria-describedby="alt-count">${escape(image.alt || "")}</textarea><small id="alt-count" aria-hidden="true"></small></label>${ai && !blocked ? `<button type="button" class="secondary" id="alt-suggest">${t("Suggest a description with AI")}</button>` : ""}<p id="alt-status" role="status"></p><div class="dialog-footer"><button class="primary">${t("Save alternative text")}</button></div></form>`,
        (d) => {
          const field = d.querySelector("#alt-text"),
            opened = image.alt || "";
          const count = () =>
            (d.querySelector("#alt-count").textContent =
              `${field.value.length} / 1000`);
          field.oninput = count;
          count();
          field.focus();
          d.querySelector("#alt-suggest")?.addEventListener(
            "click",
            async (e) => {
              const out = d.querySelector("#alt-status"),
                requested = field.value;
              e.target.disabled = true;
              out.textContent = t("Describing the image…");
              try {
                const text = await ai.ask(
                  "describe",
                  `Write alternative text for this image from a collaborative whiteboard, in ${field.lang || (language === "fr" ? "Canadian French" : "English")}. Describe the essential content in one or two plain sentences (at most 300 characters). Transcribe short visible text. Do not start with "Image of". Reply with the text only.`,
                  await downscaleDataURL(image.src),
                );
                if (!d.isConnected) return;
                if (field.value !== requested) {
                  out.textContent = t("Your description changed while AI was working. It has been kept. Request another suggestion to replace it.");
                  return;
                }
                field.value = suggestionText(text);
                count();
                out.textContent = t("Review the suggestion before saving.");
                field.focus();
              } catch (error) {
                out.textContent = t(error.message);
              } finally {
                e.target.disabled = false;
              }
            },
          );
          d.querySelector("#alt-form").onsubmit = (e) => {
            e.preventDefault();
            const value = field.value.trim();
            // The image may have been removed or locked, or access changed,
            // while the dialog was open.
            const target = board()?.items.find((i) => i.id === image.id);
            if (!target) {
              d.close();
              return toast(
                drawing
                  ? "This drawing is no longer on the board."
                  : "This image is no longer on the board.",
              );
            }
            if (!canEdit(new Set([target.id]))) return;
            // Nothing changed here: someone else's newer text stays.
            if (value === opened.trim()) return d.close();
            if ((target.alt || "") !== opened)
              return toast("This object changed. Open it again to edit it.");
            mutate(() => {
              if (value) target.alt = value;
              else delete target.alt;
            });
            d.close();
            toast(value ? "Alternative text saved." : "Marked as decorative.");
          };
        },
      );
    },
  };
}

addTranslations({
  "Alternative text": "Texte de remplacement",
  "Describe what the image shows and why it matters on this board. Leave it empty for purely decorative images.":
    "Décrivez ce que montre l’image et pourquoi elle est utile sur ce tableau. Laissez vide pour une image purement décorative.",
  "Describe what the drawing shows and why it matters on this board. Leave it empty for purely decorative drawings.":
    "Décrivez ce que montre le dessin et pourquoi il est utile sur ce tableau. Laissez vide pour un dessin purement décoratif.",
  "This drawing is no longer on the board.":
    "Ce dessin n’est plus sur le tableau.",
  "Select one image or drawing first.":
    "Sélectionnez d’abord une image ou un dessin.",
  "Suggest a description with AI": "Proposer une description avec l’IA",
  "Save alternative text": "Enregistrer le texte de remplacement",
  "Describing the image…": "Description de l’image…",
  "Review the suggestion before saving.":
    "Relisez la suggestion avant d’enregistrer.",
  "Your description changed while AI was working. It has been kept. Request another suggestion to replace it.":
    "Votre description a changé pendant le travail de l’IA. Elle a été conservée. Demandez une autre suggestion pour la remplacer.",
  "Alternative text saved.": "Texte de remplacement enregistré.",
  "This image is no longer on the board.":
    "Cette image n’est plus sur le tableau.",
  "Marked as decorative.": "Marquée comme décorative.",
  "Invalid alternative text.": "Texte de remplacement non valide.",
  Accessibility: "Accessibilité",
  "Show to participants": "Afficher aux participants",
  "Hide from participants": "Masquer aux participants",
  Workshop: "Atelier",
  "Only facilitators can hide objects.":
    "Seuls les animateurs peuvent masquer des objets.",
  "Up to 500 objects can be hidden.":
    "Jusqu’à 500 objets peuvent être masqués.",
  "Hidden from participants. You still see these objects.":
    "Masqués aux participants. Vous voyez toujours ces objets.",
  "Shown to participants.": "Affichés aux participants.",
  "Objects in a hidden frame stay hidden until the frame is shown.":
    "Les objets d’un cadre masqué restent masqués jusqu’à ce que le cadre soit affiché.",
  "Read by screen readers. Leave empty for decorative images. The command palette's Alternative text can suggest one with AI.":
    "Lu par les lecteurs d’écran. Laissez vide pour une image décorative. La commande Texte de remplacement de la palette peut en proposer un avec l’IA.",
  "Select one image first.": "Sélectionnez d’abord une image.",
});
