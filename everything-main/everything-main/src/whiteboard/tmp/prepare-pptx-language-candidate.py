from pathlib import Path
s=Path('src/export-pptx.js').read_text()
s=s.replace('import { textOf } from "./export-layout.js";','''import { textOf } from "./export-layout.js";
import { canonicalLanguage } from "./accessibility/language-tag.js";
import { appendRun, sliceTextRuns, textSegments } from "./rich-text.js";
import { tableCellContent } from "./table-language.js";''')
s=s.replace('const titleShape = (text, lang) =>','''function drawingRuns(content, language, limit = Infinity) {
  const runs = [];
  const text = content.text.slice(0, limit);
  for (const part of textSegments(text, content.textRuns))
    appendRun(runs, part.start, part.end, {
      lang:
        canonicalLanguage(part.style.lang) ||
        canonicalLanguage(content.lang) ||
        language,
    });
  return runs
    .map(
      (run) =>
        `<a:r><a:rPr lang="${run.style.lang}" dirty="0"/><a:t>${xml(text.slice(run.start, run.end))}</a:t></a:r>`,
    )
    .join("");
}
const titleShape = (content, lang) =>''')
s=s.replace('${text ? `<a:r><a:rPr lang="${lang}" dirty="0"/><a:t>${xml(text)}</a:t></a:r>` :', '${content.text ? drawingRuns(content, lang) :')
a=s.index('// Speaker notes list')
b=s.index('\nfunction base64Bytes',a)
s=s[:a]+'''// Speaker notes list the region's text in reading order, with the
// description of each image or drawing that has one. Carry the author\'s
// language ranges through the same whitespace and table separators as before.
function noteContent(i) {
  if (i.type !== "table") {
    const text = ["image", "pen"].includes(i.type) ? i.alt : textOf(i);
    return { text, lang: i.lang, textRuns: text === i.text ? i.textRuns : [] };
  }
  let text = "";
  const textRuns = [];
  i.cells.forEach((row, r) => {
    if (r) text += "\\n";
    row.forEach((_, c) => {
      if (c) text += "\\t";
      const cell = tableCellContent(i, r, c),
        start = text.length;
      text += cell.text;
      for (const part of textSegments(cell.text, cell.textRuns)) {
        const lang = canonicalLanguage(part.style.lang) || cell.lang;
        if (lang)
          appendRun(textRuns, start + part.start, start + part.end, { lang });
      }
    });
  });
  return { text, lang: i.lang, textRuns };
}
function noteLines(content) {
  const lines = [];
  let start = 0;
  for (const newline of content.text.matchAll(/\\r\\n?|\\n|$/g)) {
    let text = "";
    const runs = [];
    for (const part of textSegments(
      content.text.slice(start, newline.index),
      sliceTextRuns(content.textRuns, start, newline.index),
    )) {
      const at = text.length;
      text += part.text.replaceAll("\\t", " | ");
      const lang = canonicalLanguage(part.style.lang);
      if (lang) appendRun(runs, at, text.length, { lang });
    }
    const from = text.length - text.trimStart().length,
      end = text.trimEnd().length;
    if (end > from)
      lines.push({
        text: text.slice(from, end),
        lang: content.lang,
        textRuns: sliceTextRuns(runs, from, end),
      });
    start = newline.index + newline[0].length;
  }
  return lines;
}
function regionNoteContent(region) {
  return region.items
    .filter((i) => !["image", "pen"].includes(i.type) || i.alt)
    .filter((i) => i.type !== "frame" || i.text !== region.name)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .flatMap((i) => noteLines(noteContent(i)));
}
export function regionNotes(region) {
  return regionNoteContent(region).map((line) => line.text);
}
''' + s[b:]
s=s.replace('notes: regionNotes(region)', 'notes: regionNoteContent(region)')
s=s.replace('const descr = `${title}. ${notes.join(" ")}`.slice(0, 1000);','''const frame = b.items.find((i) => i.id === region.frameId);
    const titleContent =
      frame?.text === title ? frame : { text: title };
    const descr = `${title}. ${notes.map((line) => line.text).join(" ")}`.slice(0, 1000);''')
s=s.replace('titleShape(title, language)', 'titleShape(titleContent, language)')
s=s.replace('<a:p><a:r><a:rPr lang="${language}" dirty="0"/><a:t>${xml(line.slice(0, 2000))}</a:t></a:r></a:p>','<a:p>${drawingRuns(line, language, 2000)}</a:p>')
s=s.replace('from "./','from "../src/')
Path('tmp/pptx-language-candidate.js').write_text(s)
