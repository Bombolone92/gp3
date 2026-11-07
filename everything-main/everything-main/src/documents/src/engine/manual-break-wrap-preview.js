/** Private cell display view: preserve line breaks and placement, omit unsupported cell wrapping. */
export function manualBreakWrapPreview(paragraphs) {
  const approximations = [];
  const display = paragraphs.map((paragraph, index) => {
    const text = paragraph.runs.map(run => run.text || '').join('');
    // Page/column breaks require a different placement policy; do not hide those failures.
    // Ordinary body/header/footer manual breaks retain their text exclusions.
    // Wrapping inside a table cell still requires a separate flow policy.
    if (!paragraph.cellId || !text.includes('\v') || /[\f\u000e]/.test(text)) return paragraph;
    let changed = false, drawingIndex = 0;
    const runs = paragraph.runs.map((run, ri) => {
      if (run.image) drawingIndex++;
      const anchor = run.image?.anchor;
      if (!anchor || anchor.wrap === 'none') return run;
      changed = true;
      approximations.push({ paragraphId: paragraph.id, run: ri,
        reason: 'Wrapped drawings inside table cells are not supported yet.',
        message: `Paragraph ${index + 1}, drawing ${drawingIndex}: picture text wrapping inside a table cell is unsupported. The picture keeps its position without text wrapping in this read-only preview; text may overlap it.` });
      return { ...run, image: { ...run.image, anchor: { ...anchor, wrap: 'none' } } };
    });
    return changed ? { ...paragraph, runs } : paragraph;
  });
  return { paragraphs: approximations.length ? display : paragraphs, approximations };
}
