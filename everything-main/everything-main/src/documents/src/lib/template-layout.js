/**
 * Lay out a template's blocks (see templates.js) in a blank canvas document,
 * through the same model commands the toolbar uses. The document must define
 * Title, Subtitle and Heading 1–3, as new documents do.
 */
const STYLE = { title: 'Title', subtitle: 'Subtitle', heading: level => `Heading${level}`, paragraph: 'Normal' };

export function layoutTemplate(model, blocks) {
  // The blank document's paragraph, and the one a table leaves after it, are reused.
  let reuse = true;
  const next = () => {
    model.select(model.text.length);
    if (!reuse) model.insertParagraph();
    reuse = false;
  };
  const list = kind => {
    const current = model.listFormatting;
    if (current === kind) return;
    if (current === 'bullet' || current === 'number') model.toggleList(current);
    if (kind) model.toggleList(kind);
  };
  const line = (text, styleId, kind = null) => {
    next();
    model.setParagraphStyle(styleId);
    list(kind);
    if (text) model.replace(text);
  };
  for (const block of blocks) {
    if (block.kind === 'bullets' || block.kind === 'numbers') {
      for (const item of block.items) line(item, STYLE.paragraph, block.kind === 'bullets' ? 'bullet' : 'number');
    } else if (block.kind === 'table') {
      model.select(model.text.length);
      const columns = Math.max(...block.rows.map(row => row.length));
      model.insertTable(block.rows.length, columns);
      block.rows.forEach((row, r) => {
        for (let c = 0; c < columns; c++) {
          if (row[c]) model.replace(row[c]);
          if (r < block.rows.length - 1 || c < columns - 1) model.moveCell(1);
        }
      });
      // The paragraph after the table takes the next block, or stays as a plain closing paragraph.
      model.select(model.text.length);
      model.setParagraphStyle(STYLE.paragraph);
      list(null);
      reuse = true;
    } else {
      const styleId = block.kind === 'heading' ? STYLE.heading(block.level) : STYLE[block.kind] || STYLE.paragraph;
      line(block.text, styleId);
    }
  }
  model.select(0);
}
