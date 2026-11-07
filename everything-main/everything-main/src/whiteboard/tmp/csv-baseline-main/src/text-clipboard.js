import { listClipboardHTML } from "./text-blocks.js";
import { textSegments, sliceTextRuns } from "./rich-text.js";
import { textLinkURL } from "./text-link-data.js";

export function textClipboardHTML(doc, text, runs, blocks) {
  return listClipboardHTML(doc, text, blocks, (parent, value, start) => {
    for (const part of textSegments(
      value,
      sliceTextRuns(runs, start, start + value.length),
    )) {
      const url = textLinkURL(part.style.link),
        target = doc.createElement(url ? "a" : "span");
      if (url) {
        target.href = url;
        target.rel = "noopener noreferrer";
      }
      if (part.style.bold) target.style.fontWeight = "600";
      if (part.style.italic) target.style.fontStyle = "italic";
      target.style.textDecoration = [
        part.style.underline && "underline",
        part.style.strike && "line-through",
      ]
        .filter(Boolean)
        .join(" ");
      if (part.style.textColor) target.style.color = part.style.textColor;
      if (part.style.highlight)
        target.style.backgroundColor = part.style.highlight;
      if (part.style.lang) target.lang = part.style.lang;
      part.text.split("\u2028").forEach((s, n) => {
        if (n) target.append(doc.createElement("br"));
        target.append(doc.createTextNode(s));
      });
      parent.append(target);
    }
  });
}
