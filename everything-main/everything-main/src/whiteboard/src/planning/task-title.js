import { canonicalLanguage } from "../accessibility/language-tag.js";
import { appendRun } from "../rich-text.js";

// Map retained characters to source declarations while collapsing whitespace.
// Notifications use the default cap; task views retain their complete titles.
export function capturedTaskTitle(item, limit = 200) {
  const raw = String(item.text || ""),
    source = item.textRuns || [],
    tags = source.map((run) => canonicalLanguage(run.style.lang)),
    lang = canonicalLanguage(item.lang),
    runs = [];
  let title = "",
    at = 0,
    index = 0,
    space;
  const add = (character, tag) => {
    if (title.length + character.length > limit) return false;
    const start = title.length;
    title += character;
    if (tag) appendRun(runs, start, title.length, { lang: tag });
    return true;
  };
  for (const character of raw) {
    if (title.length === limit) break;
    while (source[index]?.end <= at) index++;
    const tag = source[index]?.start <= at ? tags[index] : null;
    if (/\s/u.test(character)) {
      if (title && !space) space = { tag };
    } else {
      if (space) {
        if (!add(" ", space.tag)) break;
        space = undefined;
      }
      if (!add(character, tag)) break;
    }
    at += character.length;
  }
  return {
    title: title || "Untitled task",
    titleGenerated: !title,
    ...(title && lang ? { titleLang: lang } : {}),
    ...(runs.length ? { titleRuns: runs } : {}),
  };
}
