/** Private display view: keep signed placement when wrapping is unsupported. */
export function negativeWrapPreview(paragraphs) {
  const approximations = [];
  const display = paragraphs.map((paragraph, index) => {
    let changed = false, drawingIndex = 0;
    const runs = paragraph.runs.map((run, ri) => {
      if (run.image) drawingIndex++;
      const anchor = run.image?.anchor;
      if (anchor?.wrap !== 'topAndBottom' || anchor.vertical !== 'paragraph' || !(anchor.y < 0)) return run;
      changed = true;
      approximations.push({ paragraphId: paragraph.id, run: ri,
        reason: 'Top-and-bottom drawings with negative paragraph offsets are not supported yet.',
        message: `Paragraph ${index + 1}, drawing ${drawingIndex}: top-and-bottom wrapping with a negative paragraph offset is unsupported. The picture keeps its position without text wrapping in this read-only preview; text may overlap it.` });
      return { ...run, image: { ...run.image, anchor: { ...anchor, wrap: 'none' } } };
    });
    return changed ? { ...paragraph, runs } : paragraph;
  });
  return { paragraphs: approximations.length ? display : paragraphs, approximations };
}
