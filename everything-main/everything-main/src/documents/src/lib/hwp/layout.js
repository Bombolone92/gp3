/** Resolve page-local controls before writing the section-local DOCX headers. */
import { check, LIMITS } from './binary.js';

// Tables and drawing text share the containing body page. Headers, footnotes
// and comments have their own stories and must not hide their caller's page.
function takeHiding(blocks, hidden, depth = 0) {
  check(depth <= LIMITS.depth);
  for (const item of blocks || []) {
    if (item.kind === 'pageHiding') {
      for (const key of ['hideFirstHeader', 'hideFirstFooter', 'hideFirstPageNum']) hidden[key] ||= item[key];
    }
    if (item.kind === 'note' || item.kind === 'comment') continue;
    if (item.runs) { takeHiding(item.runs, hidden, depth + 1); item.runs = item.runs.filter((r) => r.kind !== 'pageHiding'); }
    if (item.blocks) takeHiding(item.blocks, hidden, depth + 1);
    if (item.children) takeHiding(item.children, hidden, depth + 1);
    for (const cell of item.cells || []) takeHiding(cell.blocks, hidden, depth + 1);
    if (item.caption) takeHiding(item.caption, hidden, depth + 1);
  }
}

export function resolvePageHiding(model) {
  const sections = [];
  for (const section of model.sections) {
    const pages = new Map(); let start = 0, previousY, ambiguous = false;
    section.blocks.forEach((p, index) => {
      // Recorded line positions also identify automatic page breaks. A column
      // reset is ambiguous, so only use vertical resets in single-column text.
      const positions = p.sourceLinePositions || [], reset = positions.length && previousY !== undefined && positions[0] < previousY;
      const explicit = p.pageBreak || model.paras[p.para]?.pageBreak;
      // A paragraph that began a new page in Hanword after a page that ended early
      // (an object or heading moved to the next page) starts one here too, so
      // those breaks survive the editor's own fonts. Pages that ran full break
      // naturally; forcing them would leave a spill page behind wider fonts.
      const page = section.page, textHeight = page ? page.height - page.top - page.bottom : 0;
      if (index && !explicit && reset && (section.columns || 1) === 1 && textHeight > 0 && previousY < textHeight * 0.8) { p.pageBreak = true; model.warnings.add('Page breaks follow the pages recorded in the Hanword file where a page ended early.'); }
      if (index && (explicit || reset && (section.columns || 1) === 1)) { start = index; ambiguous = false; }
      else if (reset && (section.columns || 1) > 1) ambiguous = true;
      if (positions.some((y, i) => i && y < positions[i - 1])) ambiguous = true;
      if (positions.length) previousY = positions.at(-1);
      // Line numbering is emulated from the recorded line positions; keep them where a section numbers its lines.
      if (section.lineNumbers && positions.length) p.linePositions = positions.slice();
      delete p.sourceLinePositions;
      const hidden = {}; takeHiding([p], hidden);
      if (Object.values(hidden).some(Boolean)) {
        if (ambiguous) model.warnings.add('Page hiding in a paragraph spanning pages or columns uses its starting page.');
        if (!pages.has(start)) pages.set(start, {});
        for (const [key, value] of Object.entries(hidden)) pages.get(start)[key] ||= value;
      }
    });
    let current = section, from = 0;
    for (const [index, hidden] of pages) {
      if (index) {
        sections.push({ ...current, blocks: section.blocks.slice(from, index) });
        current = { ...section, headers: [], footers: [], pageStart: 0, hideFirstHeader: false, hideFirstFooter: false, hideFirstPageNum: false, breakType: 'nextPage' };
        // The section break replaces this page break, including one inherited
        // from a paragraph definition. Keeping both produces an empty page.
        const p = section.blocks[index];
        p.pageBreak = false;
        if (model.paras[p.para]?.pageBreak) p.props = { ...model.paras[p.para], ...p.props, pageBreak: false };
        from = index;
      }
      for (const [key, value] of Object.entries(hidden)) current[key] ||= value;
    }
    sections.push({ ...current, blocks: section.blocks.slice(from) });
    check(sections.length <= 1000, 'This Hanword document has too many page layout sections.');
  }
  model.sections = sections;
}
