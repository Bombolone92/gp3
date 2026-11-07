import { pageFieldValue } from './docx-page-fields.js';
import { pageNumberSequence } from './page-numbering.js';

export const shapeHasFields = node => !!node.text?.paragraphs.some(p => p.runs.some(r => r.field)) || !!node.children?.some(shapeHasFields);

export function shapeFieldParagraphs(paragraphs, context) {
  return paragraphs.map(p => ({ ...p, runs: p.runs.map(r => {
    if (!r.field) return r;
    const value = context ? pageFieldValue(r.field, context) : null;
    return { ...r, text: value ?? r.field.cachedText, ...(value != null && context.pageStory && r.field.type === 'PAGE' ? { capitalization: 'normal' } : {}) };
  }) }));
}

export function drawingPageContexts(layout, definition) {
  const numbers = pageNumberSequence(layout.pageSections, definition, layout.numberingApproximations), counts = new Map();
  layout.pageSections.forEach((owner,page) => {
    for (const section of layout.pageRegions?.[page] ? new Set(layout.pageRegions[page].map(r=>r.section)) : [owner])
      if (section !== null) counts.set(section, (counts.get(section) || 0) + 1);
  });
  return layout.pageSections.map((section, page) => {
    const context = section => ({ pageNumber: numbers[page], pageCount: layout.pageCount,
      sectionPageCount: counts.get(section), pageNumbering: definition?.sections[section]?.pageNumbering });
    return { ...context(section), ...(layout.pageRegions?.[page]?.length ? {
      regions: layout.pageRegions[page].map(region => context(region.section)),
    } : {}) };
  });
}

export function drawingPageContext(contexts, page, region) {
  return contexts[page]?.regions?.[region] || contexts[page];
}
