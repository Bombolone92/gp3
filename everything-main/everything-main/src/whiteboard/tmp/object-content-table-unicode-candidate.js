import { tableTextContent } from "../src/table-language.js";
import { objectName, objectNameContent } from "./i18n-table-unicode-candidate.js";
import { textSegments, sliceTextRuns } from "../src/rich-text.js";
import { canonicalLanguage } from "../src/accessibility/language-tag.js";

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function languageAttribute(value) {
  const tag = canonicalLanguage(value);
  return tag ? ` lang="${escape(tag)}"` : "";
}
export function authoredTextHTML(
  i,
  text = i.text || "",
  start = 0,
  collapseWhitespace = false,
) {
  const parts = textSegments(
    text,
    sliceTextRuns(i.textRuns, start, start + text.length),
  );
  return (
    `<span data-user-content${languageAttribute(i.lang)}>` +
    parts
      .map(
        (part) =>
          `<span${languageAttribute(part.style.lang)}>${escape(collapseWhitespace ? part.text.replace(/\s+/g, " ") : part.text)}</span>`,
      )
      .join("") +
    "</span>"
  );
}
export function objectNameHTML(i, limit = Infinity) {
  const name = objectName(i);
  const content = objectNameContent(i);
  if (!content) return escape(name.slice(0, limit));
  const prefix = name.slice(0, name.length - content.length);
  const value = content.slice(0, Math.max(0, limit - prefix.length));
  if (i.cells && !i.text && !i.alt && !i.fileName) {
    const combined = tableTextContent(i, {
      limit: Math.min(300, Math.max(0, limit - prefix.length)),
    });
    return escape(prefix) + authoredTextHTML(combined);
  }
  const parts = i.text
    ? textSegments(value, i.textRuns)
    : [{ text: value, style: {} }];
  return (
    escape(prefix) +
    `<span data-user-content${languageAttribute(i.lang)}>` +
    parts
      .map(
        (part) =>
          `<span${languageAttribute(part.style.lang)}>${escape(part.text)}</span>`,
      )
      .join("") +
    "</span>"
  );
}
