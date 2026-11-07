import { addTranslations, t } from "./i18n.js";

// @mention suggestions for a text field. A textarea cannot take the
// combobox role, so it names the list it controls and its highlighted
// option, and a status announces how many people match. Choosing a person
// inserts "@username ", which the worker turns into a notification for that
// board member.
export function mentionQuery(text, caret) {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])@([A-Za-z0-9_.-]{0,64})$/.exec(before);
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
}
export function matchPeople(people, query, limit = 8) {
  const q = query.toLowerCase();
  const seen = new Set();
  return people
    .filter((p) => p?.name && /^[A-Za-z0-9_.-]{2,64}$/.test(p.name))
    .filter((p) => {
      const key = p.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return !q || key.startsWith(q) || key.includes(q);
    })
    .sort(
      (a, b) =>
        Number(!a.name.toLowerCase().startsWith(q)) -
          Number(!b.name.toLowerCase().startsWith(q)) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}
let counter = 0;
export function attachMentions(field, people) {
  const doc = field.ownerDocument;
  const id = `mention-list-${++counter}`;
  const list = doc.createElement("ul");
  list.id = id;
  list.className = "mention-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t("People to mention"));
  list.hidden = true;
  field.after(list);
  const status = doc.createElement("span");
  status.className = "sr-only";
  status.setAttribute("role", "status");
  list.after(status);
  field.setAttribute("aria-autocomplete", "list");
  field.setAttribute("aria-controls", id);
  let matches = [],
    active = 0,
    range = null,
    closing;
  const close = () => {
    clearTimeout(closing);
    list.hidden = true;
    matches = [];
    field.removeAttribute("aria-activedescendant");
  };
  const render = () => {
    list.innerHTML = matches
      .map(
        (p, n) =>
          `<li id="${id}-${n}" role="option" aria-selected="${n === active}" data-index="${n}"></li>`,
      )
      .join("");
    list.querySelectorAll("li").forEach((li, n) => {
      li.textContent = `@${matches[n].name}`;
      // Pressing keeps focus in the text box; the click, which assistive
      // technology and voice control also send, chooses the person.
      li.onmousedown = (e) => e.preventDefault();
      li.onclick = () => choose(n);
    });
    list.hidden = !matches.length;
    status.textContent = matches.length
      ? `${matches.length} ${t(matches.length === 1 ? "person to mention" : "people to mention")}`
      : "";
    if (matches.length) {
      field.setAttribute("aria-activedescendant", `${id}-${active}`);
      // The list scrolls, so the highlighted person stays in view.
      list.children[active]?.scrollIntoView?.({ block: "nearest" });
    } else field.removeAttribute("aria-activedescendant");
  };
  const update = () => {
    clearTimeout(closing);
    range = mentionQuery(
      field.value,
      field.selectionStart ?? field.value.length,
    );
    matches = range ? matchPeople(people(), range.query) : [];
    active = 0;
    render();
  };
  function choose(n) {
    const person = matches[n];
    if (!person || !range) return close();
    const caret = field.selectionStart ?? field.value.length;
    const insert = `@${person.name} `;
    field.value =
      field.value.slice(0, range.start) + insert + field.value.slice(caret);
    const at = range.start + insert.length;
    field.setSelectionRange(at, at);
    close();
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
  }
  const onKey = (e) => {
    if (
      e.target !== field ||
      list.hidden ||
      !matches.length ||
      e.isComposing ||
      e.keyCode === 229
    )
      return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopImmediatePropagation();
      active =
        (active + (e.key === "ArrowDown" ? 1 : matches.length - 1)) %
        matches.length;
      render();
    } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
      // The caret may have moved since the list opened; a suggestion only
      // replaces the mention being typed at the caret.
      const now = mentionQuery(
        field.value,
        field.selectionStart ?? field.value.length,
      );
      if (!now || now.start !== range?.start) return close();
      e.preventDefault();
      e.stopImmediatePropagation();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  };
  // Capture on an ancestor so suggestions take Enter before the form posts.
  const host = field.parentElement;
  host.addEventListener("keydown", onKey, true);
  field.addEventListener("input", update);
  field.addEventListener("click", update);
  field.addEventListener("focus", update);
  // Keys that move the caret refresh or close the suggestions.
  const moved = (e) =>
    ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(
      e.key,
    ) && update();
  field.addEventListener("keyup", moved);
  // A click on a suggestion lands before the list closes.
  const blurred = () => (closing = setTimeout(close, 150));
  field.addEventListener("blur", blurred);
  return {
    close,
    detach() {
      host.removeEventListener("keydown", onKey, true);
      field.removeEventListener("input", update);
      field.removeEventListener("click", update);
      field.removeEventListener("focus", update);
      field.removeEventListener("keyup", moved);
      field.removeEventListener("blur", blurred);
      clearTimeout(closing);
      list.remove();
      status.remove();
    },
  };
}

addTranslations({
  "People to mention": "Personnes à mentionner",
  "person to mention": "personne à mentionner",
  "people to mention": "personnes à mentionner",
});
