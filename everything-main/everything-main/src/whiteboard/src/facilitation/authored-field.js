// Plain authored fields retain language ranges through native editing and
// expose the same whole-field/passage choices as other authored content.
import { createTextEditor } from "../text-editor.js";
import { t } from "../i18n.js";
import { canonicalLanguage } from "../accessibility/language-tag.js";
import {
  appendRun,
  formatTextRuns,
  sliceTextRuns,
  validateTextRuns,
} from "../rich-text.js";

export function fieldContent(input, start = 0, end = input.value.length) {
  // Persisted field/line limits must not split a surrogate pair.
  if (
    end > start &&
    /[\uD800-\uDBFF]/.test(input.value[end - 1] || "") &&
    /[\uDC00-\uDFFF]/.test(input.value[end] || "")
  )
    end--;
  const text = input.value.slice(start, end),
    runs = [];
  for (const r of sliceTextRuns(input.textRuns, start, end)) {
    const lang = canonicalLanguage(r.style.lang);
    if (lang) appendRun(runs, r.start, r.end, { lang });
  }
  const lang = canonicalLanguage(
    input.fieldLanguage ? input.fieldLanguage() : input.lang,
  );
  return {
    text,
    ...(lang ? { lang } : {}),
    ...(runs.length ? { textRuns: runs } : {}),
  };
}
export function trimmedFieldContent(input) {
  const start = input.value.length - input.value.trimStart().length;
  return fieldContent(input, start, input.value.trimEnd().length);
}
export function createAuthoredField(placeholder, source, options) {
  const doc = placeholder.ownerDocument,
    id = placeholder.id;
  const input = createTextEditor(doc, source, {
    plainTextOnly: true,
    ...options,
  });
  input.id = id;
  input.defaultValue = input.value;
  input.className = "authored-label-field fac-authored-input";
  input.tabIndex = 0;
  input.setAttribute("data-user-content", "");
  input.setAttribute("aria-labelledby", `${id}-label`);
  if (options.required) input.setAttribute("aria-required", "true");
  const wrapper = doc.createElement("div");
  placeholder.replaceWith(wrapper);
  wrapper.append(input);
  wrapper.insertAdjacentHTML(
    "beforeend",
    `<button id="${id}-language-options" class="text-btn" type="button" aria-labelledby="${id}-language-action ${id}-label" aria-expanded="false" aria-controls="${id}-language-controls"><span id="${id}-language-action">${t("Content language")}</span></button><div id="${id}-language-controls" hidden></div>`,
  );
  const generatedButton = wrapper.querySelector("button"),
    controls = wrapper.lastElementChild;
  const button = options.languageButton || generatedButton;
  if (options.languageButton) {
    generatedButton.remove();
    button.setAttribute("aria-controls", controls.id);
    button.setAttribute("aria-expanded", "false");
  }
  input.languageControls = controls;
  let whole = canonicalLanguage(source.lang),
    inherited = canonicalLanguage(options.inheritedLanguage),
    popup;
  input.fieldLanguage = () => whole;
  input.inheritLanguage = (lang) => {
    inherited = canonicalLanguage(lang);
    setWhole(whole);
  };
  function setWhole(lang) {
    whole = canonicalLanguage(lang);
    if (whole || inherited) input.lang = whole || inherited;
    else input.removeAttribute("lang");
    input.setBaseStyle({ lang: whole || inherited });
  }
  setWhole(whole);
  input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
  if (options.multiline === false)
    input.addEventListener("keydown", (e) => {
      if (
        e.key === "Enter" &&
        !e.isComposing &&
        e.keyCode !== 229 &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        input.closest("form")?.requestSubmit();
      }
    });
  const original = JSON.stringify(fieldContent(input));
  function hide(focus = false) {
    popup = undefined;
    controls.hidden = true;
    controls.replaceChildren();
    button.setAttribute("aria-expanded", "false");
    if (focus) button.focus();
  }
  function show(state) {
    popup = state || {
      start: input.selectionStart,
      end: input.selectionEnd,
      direction: input.selectionDirection,
      text: input.value,
    };
    const phrase = popup.end > popup.start;
    controls.innerHTML = `<label class="field">${t("Apply to")}<select id="${id}-language-scope">${phrase ? `<option value="text">${t("Selected text")}</option>` : ""}<option value="field">${t("Whole field")}</option></select></label><label class="field">${t("Language tag")}<input id="${id}-language-tag" maxlength="64" autocomplete="off" spellcheck="false" placeholder="fr-CA" aria-describedby="${id}-language-help ${id}-language-error"></label><p class="dialog-copy" id="${id}-language-help">${t("Enter a language tag, such as en, fr-CA, or es. Leave empty to inherit the surrounding language.")}</p><p id="${id}-language-error" role="alert" hidden></p><div class="dialog-footer"><button type="button" class="text-btn" id="${id}-language-cancel">${t("Cancel")}</button><button type="button" class="secondary" id="${id}-language-save">${t("Apply language")}</button></div>`;
    const scope = controls.querySelector("select"),
      tag = controls.querySelector("input"),
      error = controls.querySelector('[role="alert"]');
    const sync = () => {
      const value = scope.value === "text" ? input.rangeStyle("lang") : whole;
      tag.value = value && value !== "mixed" ? value : "";
    };
    scope.onchange = sync;
    sync();
    if (popup.scope) scope.value = popup.scope;
    if (popup.tag !== undefined) tag.value = popup.tag;
    if (popup.error) {
      error.hidden = false;
      error.textContent = popup.error;
    }
    controls.hidden = false;
    button.setAttribute("aria-expanded", "true");
    controls.querySelector(`#${id}-language-cancel`).onclick = () => hide(true);
    controls.querySelector(`#${id}-language-save`).onclick = () => {
      const value = tag.value.trim(),
        lang = value ? canonicalLanguage(value) : null;
      let message;
      if (value && !lang)
        message = t("Enter a valid language tag, such as en or fr-CA.");
      else if (scope.value === "text" && input.value !== popup.text)
        message = t("The selected text changed. Select it again.");
      else if (scope.value === "text") {
        try {
          validateTextRuns(
            input.value,
            formatTextRuns(
              input.value,
              input.textRuns,
              popup.start,
              popup.end,
              { lang },
            ),
          );
        } catch {
          message = t("Select complete characters to set their language.");
        }
      }
      if (message) {
        error.hidden = false;
        error.textContent = message;
        tag.setAttribute("aria-invalid", "true");
        tag.focus();
        return;
      }
      if (scope.value === "text") {
        input.setSelectionRange(popup.start, popup.end, popup.direction);
        input.format("lang", lang);
      } else setWhole(lang);
      hide(true);
    };
    tag.oninput = () => {
      error.hidden = true;
      tag.removeAttribute("aria-invalid");
    };
    controls.onkeydown = (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        hide(true);
      } else if (e.key === "Enter" && !e.target.closest("button")) {
        // Enter applies from the fields; on a button it presses that button.
        e.preventDefault();
        e.stopPropagation();
        controls.querySelector(`#${id}-language-save`).click();
      }
    };
  }
  button.onclick = () => {
    if (controls.hidden) {
      show();
      controls.querySelector("input").focus();
    } else hide(true);
  };
  input.languageState = () => ({
    content: fieldContent(input),
    edited: JSON.stringify(fieldContent(input)) !== original,
    selection: {
      start: input.selectionStart,
      end: input.selectionEnd,
      direction: input.selectionDirection,
    },
    ...(popup
      ? {
          popup: {
            ...popup,
            scope: controls.querySelector("select").value,
            tag: controls.querySelector("input").value,
            error: controls.querySelector('[role="alert"]').hidden
              ? ""
              : controls.querySelector('[role="alert"]').textContent,
          },
        }
      : {}),
  });
  input.restoreLanguageState = (state) => {
    if (state.edited) {
      setWhole(state.content.lang);
      input.setRichText(state.content.text, state.content.textRuns || []);
    }
    input.setSelectionRange(
      state.selection.start,
      state.selection.end,
      state.selection.direction,
    );
    if (state.popup) show(state.popup);
  };
  return input;
}
